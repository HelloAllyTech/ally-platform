import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, QueryFailedError, Repository } from 'typeorm';
import {
  AUTOMATION_LIMITS,
  resolveAutomationRepos,
} from '../constants/analytics-automation.constants';
import {
  AnalyticsAutomationRunDetailDto,
  AnalyticsAutomationRunSummaryDto,
  AnalyticsAutomationAgentRunDto,
} from '../dto/analytics-automation.dto';
import {
  AnalyticsAutomationAgentName,
  AnalyticsAutomationAgentRun,
} from '../entity/analytics-automation-agent-run.entity';
import { AnalyticsAutomationFinding } from '../entity/analytics-automation-finding.entity';
import {
  AnalyticsAutomationRun,
  AnalyticsAutomationTrigger,
} from '../entity/analytics-automation-run.entity';
import {
  clip,
  DbtGate,
  evaluateDbtGate,
} from '../util/analytics-automation.util';
import {
  AutomationPrSink,
  AutomationRunContext,
} from './analytics-automation-agent.base';
import {
  AnalyticsAutomationDbtAgent,
  DbtProposalItem,
  itemApplies,
  PosthogPrInfo,
  ProposedEvent,
} from './analytics-automation-dbt.agent';
import { AnalyticsAutomationGithubService } from './analytics-automation-github.service';
import {
  AnalyticsAutomationPosthogAgent,
  AutomationFindingInput,
} from './analytics-automation-posthog.agent';

export const AUTOMATION_ALREADY_RUNNING_MESSAGE =
  'An automation run is already in progress.';

/** A run that has been started, and a promise for when its PostHog agent and dbt analysis end. */
export interface StartedAutomationRun {
  run: AnalyticsAutomationRun;
  /** Never rejects: a failure marks the run or the agent `failed`. */
  done: Promise<void>;
}

/** What every agent shows on a run recorded because nothing was committed. */
const NO_NEW_COMMITS_SUMMARY =
  'No new commits since the last run. Nothing was reviewed and no model calls were made.';

/** Shown on the dbt agent while it waits for a person: the plan exists, nothing in dbt has changed. */
const DBT_APPROVAL_NOTE =
  'Nothing in the dbt repo has been changed yet. Approving checks the PostHog pull request on GitHub and then makes the planned changes.';

/** Why a plan item was not applied when the PostHog events pull request was not merged. */
const LEFT_OUT_DETAIL =
  'Left out: it depends on the PostHog events, and their pull request was not merged.';

const AGENT_ORDER: AnalyticsAutomationAgentName[] = [
  'posthog_events',
  'dbt_metrics',
];

/**
 * An approved dbt agent that ended without a pull request (it failed, the
 * reviewer rejected its branch, or it wrote nothing) may be approved again: the
 * plan is still there, and the retry works on a branch of its own.
 */
function canRetryApply(
  row: Pick<AnalyticsAutomationAgentRun, 'status' | 'decision' | 'prNumber'>,
): boolean {
  return (
    row.decision === 'approved' &&
    row.prNumber === null &&
    (row.status === 'failed' || row.status === 'completed')
  );
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof QueryFailedError &&
    (err.driverError as { code?: string } | undefined)?.code === '23505'
  );
}

function errorText(err: unknown): string {
  return clip(err instanceof Error ? err.message : String(err), 1_000);
}

/**
 * TypeORM's `update()` typing rejects a plain object for a jsonb column; the
 * value is stored as given. Confined here so the cast is in one place.
 */
function jsonb(value: Record<string, unknown>): never {
  return value as never;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/**
 * The weekly Analytics Automation run.
 *
 * Starting a run takes one snapshot of the platform and dbt heads, then runs the
 * PostHog events agent, then the dbt agent's ANALYSIS: what changed in the
 * platform (definition changes) and a plan of the dbt changes it would make,
 * with the plan items that exist only because of the PostHog events marked. The
 * analysis is read-only. The plan is then offered for approval, and nothing in
 * dbt is edited until a person approves. Approving checks the PostHog pull
 * request on GitHub at that moment (see `evaluateDbtGate`): still open, and the
 * approval is refused; merged, and the whole plan is applied; closed or absent,
 * and the plan is applied without the PostHog-dependent items. There is no
 * polling and no timer.
 *
 * Nothing here starts a run on request: only the scheduler does.
 */
@Injectable()
export class AnalyticsAutomationRunService {
  private readonly logger = new Logger(AnalyticsAutomationRunService.name);

  constructor(
    @InjectRepository(AnalyticsAutomationRun)
    private readonly runs: Repository<AnalyticsAutomationRun>,
    @InjectRepository(AnalyticsAutomationAgentRun)
    private readonly agentRuns: Repository<AnalyticsAutomationAgentRun>,
    @InjectRepository(AnalyticsAutomationFinding)
    private readonly findings: Repository<AnalyticsAutomationFinding>,
    private readonly github: AnalyticsAutomationGithubService,
    private readonly posthog: AnalyticsAutomationPosthogAgent,
    private readonly dbt: AnalyticsAutomationDbtAgent,
  ) {}

  // ---------------------------------------------------------------- starting

  /**
   * Registers a run and starts its PostHog agent and dbt analysis in the background. Throws a
   * 409 when a run is already in progress. The heads are read before the row
   * exists, so a GitHub failure leaves no `running` row behind.
   */
  async startScheduledRun(): Promise<StartedAutomationRun> {
    return this.startRun('scheduled');
  }

  /**
   * The same run, started on demand by a person pressing "Run now" in the admin
   * tab. It shares the one-running-at-a-time guard with the scheduled run.
   */
  async startManualRun(): Promise<StartedAutomationRun> {
    return this.startRun('manual');
  }

  private async startRun(
    trigger: AnalyticsAutomationTrigger,
  ): Promise<StartedAutomationRun> {
    await this.failStale();
    if (await this.runs.exists({ where: { status: 'running' } })) {
      throw new ConflictException(AUTOMATION_ALREADY_RUNNING_MESSAGE);
    }

    const repos = resolveAutomationRepos();
    const ranAt = new Date();
    const [platformHead, dbtHead] = await Promise.all([
      this.github.getBranchHead(repos.platform, repos.platform.base),
      this.github.getBranchHead(repos.dbt, repos.dbt.base),
    ]);

    // Diff from the last run whose first two agents both finished: a run that
    // failed reviewed nothing, so its window must be covered again.
    const previous = await this.lastSettledRun();
    const unchanged = previous?.commitShas?.platform?.head === platformHead;
    const since = previous
      ? new Date(previous.ranAt.getTime() - AUTOMATION_LIMITS.SINCE_MARGIN_MS)
      : new Date(
          ranAt.getTime() -
            AUTOMATION_LIMITS.FIRST_RUN_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
        );

    let run: AnalyticsAutomationRun;
    try {
      run = await this.runs.manager.transaction(async (manager) => {
        const saved = await manager.save(
          manager.create(AnalyticsAutomationRun, {
            ranAt,
            status: unchanged ? 'completed' : 'running',
            finishedAt: unchanged ? ranAt : null,
            trigger,
            commitShas: {
              platform: {
                base: previous?.commitShas?.platform?.head ?? null,
                head: platformHead,
                since: since.toISOString(),
              },
              dbt: { head: dbtHead },
            },
          }),
        );
        await manager.save(
          AGENT_ORDER.map((agent) =>
            manager.create(AnalyticsAutomationAgentRun, {
              runId: saved.id,
              agent,
              ...(unchanged
                ? {
                    // Nothing new to look at: recorded, with no model calls.
                    status: 'completed' as const,
                    startedAt: ranAt,
                    finishedAt: ranAt,
                    summary: NO_NEW_COMMITS_SUMMARY,
                    note: null,
                  }
                : {
                    status:
                      agent === 'dbt_metrics'
                        ? ('waiting' as const)
                        : ('running' as const),
                    // A waiting row is stamped too: the stale check below reads
                    // `startedAt` (timestamptz), never the zone-less `createdAt`.
                    startedAt: ranAt,
                    note:
                      agent === 'dbt_metrics'
                        ? 'Waiting for the PostHog events agent to finish.'
                        : null,
                  }),
              output: {},
            }),
          ),
        );
        return saved;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(AUTOMATION_ALREADY_RUNNING_MESSAGE);
      }
      throw err;
    }

    const short = (sha: string | null | undefined) =>
      sha?.slice(0, 7) ?? 'none';
    this.logger.log(
      `Run ${run.id.slice(0, 8)} (${trigger}) started: platform ${repos.platform.owner}/${repos.platform.repo}@${repos.platform.base} head ${short(platformHead)} (previous run's head ${short(previous?.commitShas?.platform?.head)}; commits since ${since.toISOString()}); dbt ${repos.dbt.owner}/${repos.dbt.repo}@${repos.dbt.base} head ${short(dbtHead)}`,
    );
    if (unchanged) {
      this.logger.log(
        `Run ${run.id.slice(0, 8)} recorded without running any agent: no new commits since run ${previous?.id.slice(0, 8)}`,
      );
      return { run, done: Promise.resolve() };
    }
    return { run, done: this.processRun(run) };
  }

  /**
   * The newest run whose PostHog agent completed AND whose dbt analysis got as
   * far as a plan (or found nothing). A run where either failed (or that is
   * still going) is skipped, so what it should have covered is covered by the
   * next one. A dbt agent that failed AFTER approval had finished its analysis.
   */
  private async lastSettledRun(): Promise<AnalyticsAutomationRun | null> {
    const candidates = await this.runs.find({
      where: { status: 'completed' },
      order: { ranAt: 'DESC' },
      take: 10,
    });
    for (const candidate of candidates) {
      const agents = await this.agentRuns.find({
        where: { runId: candidate.id },
      });
      const posthogDone = agents.some(
        (a) => a.agent === 'posthog_events' && a.status === 'completed',
      );
      const analysed = agents.some(
        (a) =>
          a.agent === 'dbt_metrics' &&
          a.status !== 'waiting' &&
          a.status !== 'analysing' &&
          !(a.status === 'failed' && a.decision === null),
      );
      if (posthogDone && analysed) return candidate;
    }
    return null;
  }

  /** Runs the PostHog agent, then the dbt analysis, then closes the run. */
  private async processRun(run: AnalyticsAutomationRun): Promise<void> {
    try {
      const ctx = this.contextFor(run);
      const rows = await this.agentRuns.find({ where: { runId: run.id } });
      const row = (agent: AnalyticsAutomationAgentName) =>
        rows.find((r) => r.agent === agent)!;

      // Neither step rejects: a failure marks its own agent row `failed`. The
      // analysis comes second because the plan covers the events PostHog proposed.
      await this.runPosthog(ctx, row('posthog_events').id);
      await this.runDbtAnalysis(ctx, row('dbt_metrics').id);
      await this.runs.update(
        { id: run.id, status: 'running' },
        { status: 'completed', finishedAt: new Date() },
      );
      this.logger.log(
        `Automation run ${run.id} finished its PostHog agent and dbt analysis`,
      );
    } catch (err) {
      this.logger.error(`Automation run ${run.id} failed: ${errorText(err)}`);
      await this.runs
        .update(
          { id: run.id, status: 'running' },
          { status: 'failed', finishedAt: new Date() },
        )
        .catch(() => undefined);
    }
  }

  private async runPosthog(
    ctx: AutomationRunContext,
    agentRunId: string,
  ): Promise<void> {
    try {
      const result = await this.posthog.run(ctx, this.sinkFor(agentRunId));
      await this.saveFindings(agentRunId, result.findings);
      await this.agentRuns.update(agentRunId, {
        status: 'completed',
        finishedAt: new Date(),
        summary: result.summary,
        output: jsonb(result.output),
      });
      this.logger.log(
        `PostHog agent ${agentRunId.slice(0, 8)} completed with ${result.findings.length} finding(s)`,
      );
    } catch (err) {
      // A pull request opened before the failure stays recorded on the row.
      this.logger.error(
        `PostHog agent ${agentRunId} failed: ${errorText(err)}`,
      );
      await this.fail(agentRunId, err);
    }
  }

  // --------------------------------------------------------------- dbt agent

  /**
   * The dbt agent's analysis. Read-only: it works out what changed in the
   * platform and plans the dbt changes, but edits nothing. The plan is saved on
   * the row and as `proposed` findings, then offered for approval. Never
   * rejects: a failure marks the row `failed`.
   */
  private async runDbtAnalysis(
    ctx: AutomationRunContext,
    agentRunId: string,
  ): Promise<void> {
    const claimed = await this.agentRuns.update(
      { id: agentRunId, status: 'waiting' },
      { status: 'analysing', startedAt: new Date(), note: null },
    );
    if (!claimed.affected) return;
    try {
      const posthogRow = await this.agentRuns.findOne({
        where: { runId: ctx.runId, agent: 'posthog_events' },
      });
      const events =
        (posthogRow?.output?.events as ProposedEvent[] | undefined) ?? [];
      const posthogPr: PosthogPrInfo | null =
        posthogRow &&
        posthogRow.prNumber !== null &&
        posthogRow.prUrl &&
        posthogRow.prState
          ? {
              number: posthogRow.prNumber,
              url: posthogRow.prUrl,
              state: posthogRow.prState,
            }
          : null;

      const analysis = await this.dbt.analyse(ctx, {
        events,
        posthogPr,
        rejectedKeys: await this.rejectedKeys(),
      });
      this.logger.log(
        `dbt analysis ${agentRunId.slice(0, 8)}: ${analysis.definitionChanges.length} definition change(s); ${analysis.needsChanges ? `${analysis.items.length} planned dbt change(s)` : 'nothing needs changing in dbt'}`,
      );
      await this.findings.delete({ agentRunId });
      await this.saveFindings(agentRunId, analysis.findings);
      const output = {
        definitionChanges: analysis.definitionChanges,
        items: analysis.items,
        overview: analysis.summary,
        withEvents: null,
      };
      if (!analysis.needsChanges) {
        await this.agentRuns.update(agentRunId, {
          status: 'completed',
          finishedAt: new Date(),
          summary: analysis.summary,
          output: jsonb(output),
        });
        return;
      }
      await this.agentRuns.update(agentRunId, {
        summary: analysis.summary,
        output: jsonb(output),
      });
      await this.openDbtForApproval(ctx.runId);
    } catch (err) {
      this.logger.error(`dbt analysis ${agentRunId} failed: ${errorText(err)}`);
      await this.fail(agentRunId, err);
    }
  }

  /**
   * Offers the analysed plan for approval. It runs NOTHING: the dbt edits start
   * only when a person approves, and the PostHog pull request is checked on
   * GitHub at that moment, not here. The note says what the pull request looked
   * like when the analysis finished.
   */
  async openDbtForApproval(runId: string): Promise<void> {
    const rows = await this.agentRuns.find({ where: { runId } });
    const dbtRow = rows.find((r) => r.agent === 'dbt_metrics');
    if (!dbtRow || dbtRow.status !== 'analysing') return;

    const gate = evaluateDbtGate(
      rows.find((r) => r.agent === 'posthog_events') ?? null,
    );
    this.logger.log(
      `dbt agent ${dbtRow.id.slice(0, 8)} is now awaiting approval (PostHog PR as of now: ${gate.open ? 'none or settled' : 'open'}); nothing in dbt has changed`,
    );
    await this.agentRuns.update(
      { id: dbtRow.id, status: 'analysing' },
      {
        status: 'awaiting_approval',
        finishedAt: null,
        note: [gate.open ? gate.note : gate.reason, DBT_APPROVAL_NOTE]
          .filter(Boolean)
          .join(' '),
      },
    );
  }

  /**
   * The gate, decided on GitHub's current answer: the PostHog pull request's
   * state is read live and saved, so a PR merged, closed or reopened since the
   * run is judged as it is now. Throws 502 when GitHub cannot be asked.
   */
  private async checkDbtGate(runId: string): Promise<DbtGate> {
    const posthog = await this.agentRuns.findOne({
      where: { runId, agent: 'posthog_events' },
    });
    if (posthog && posthog.prNumber !== null && posthog.prRepo) {
      await this.refreshPullRequest(posthog).catch((err) => {
        this.logger.warn(
          `Could not check ${posthog.prRepo}#${posthog.prNumber}: ${errorText(err)}`,
        );
        throw new BadGatewayException(
          'Could not check the PostHog pull request on GitHub. Try again in a moment.',
        );
      });
    }
    return evaluateDbtGate(posthog);
  }

  /** Reads a pull request's state from GitHub and saves it if it changed. */
  private async refreshPullRequest(
    row: AnalyticsAutomationAgentRun,
  ): Promise<void> {
    if (row.prNumber === null || !row.prRepo) return;
    const [owner, repo] = row.prRepo.split('/');
    const { state } = await this.github.getPullRequestState(
      { owner, repo },
      row.prNumber,
    );
    if (state !== row.prState) {
      await this.agentRuns.update(row.id, { prState: state });
      row.prState = state;
    }
  }

  /** Keys of dbt items a person rejected, so they are not raised again. */
  private async rejectedKeys(): Promise<string[]> {
    const rejected = await this.findings.find({
      where: { kind: 'dbt_change', status: 'rejected' },
      take: 500,
    });
    return [
      ...new Set(
        rejected
          .map((f) => f.payload?.key)
          .filter((key): key is string => typeof key === 'string'),
      ),
    ];
  }

  /**
   * A person approves: the dbt agent now starts, in the background. It makes the
   * planned changes in the dbt repo and opens a pull request, then watches the
   * pull request's CI and fixes the branch if it fails. When the PostHog
   * pull request was merged the whole plan is applied; when it was closed or
   * there was none, the items that depend on the PostHog events are left out.
   * Allowed from
   * `awaiting_approval`, and again from an approved agent that ended without a
   * pull request (see `canRetryApply`), so a GitHub hiccup or a rejected branch
   * does not strand the plan.
   */
  async approve(
    agentRunId: string,
    userId: number,
  ): Promise<AnalyticsAutomationAgentRunDto> {
    const row = await this.requireDbtRow(agentRunId);
    if (row.status !== 'awaiting_approval' && !canRetryApply(row)) {
      throw new ConflictException('This agent cannot be approved now.');
    }
    // The gate, on GitHub's answer right now: an open PostHog PR refuses.
    const gate = await this.checkDbtGate(row.runId);
    if (!gate.open) {
      this.logger.log(
        `Approve refused for dbt agent ${row.id.slice(0, 8)}: ${gate.reason}`,
      );
      throw new ConflictException(gate.reason);
    }
    this.logger.log(
      `dbt agent ${row.id.slice(0, 8)} approved by user ${userId}; PostHog events ${gate.withEvents ? 'included' : 'left out'}`,
    );

    const claimed = await this.agentRuns
      .createQueryBuilder()
      .update(AnalyticsAutomationAgentRun)
      .set({
        status: 'applying',
        decision: 'approved',
        decidedBy: userId,
        decidedAt: new Date(),
        startedAt: new Date(),
        finishedAt: null,
        note: null,
      })
      .where('"id" = :id AND "prNumber" IS NULL', { id: row.id })
      .andWhere(
        `("status" = 'awaiting_approval' OR ("status" IN ('failed', 'completed') AND "decision" = 'approved'))`,
      )
      .execute();
    if (!claimed.affected) {
      throw new ConflictException('This agent cannot be approved now.');
    }
    // Which part of the plan applies, decided just now. The plan itself stays.
    // The attempt count gives a retry its own branch (see `dbt.apply`).
    const applyAttempts =
      (typeof row.output?.applyAttempts === 'number'
        ? row.output.applyAttempts
        : 0) + 1;
    await this.agentRuns.update(row.id, {
      output: jsonb({
        ...(row.output ?? {}),
        withEvents: gate.withEvents,
        applyAttempts,
      }),
    });
    void this.runDbt(row.id);
    return this.loadAgentDto(row.id);
  }

  async reject(
    agentRunId: string,
    userId: number,
  ): Promise<AnalyticsAutomationAgentRunDto> {
    const row = await this.requireDbtRow(agentRunId);
    const claimed = await this.agentRuns.update(
      { id: row.id, status: 'awaiting_approval' },
      {
        status: 'rejected',
        decision: 'rejected',
        decidedBy: userId,
        decidedAt: new Date(),
        finishedAt: new Date(),
      },
    );
    if (!claimed.affected) {
      throw new ConflictException('This proposal cannot be rejected now.');
    }
    await this.findings.update(
      { agentRunId: row.id, status: 'proposed' },
      { status: 'rejected' },
    );
    return this.loadAgentDto(row.id);
  }

  /**
   * What happens after a person approves: apply the planned changes (the part of
   * the plan that the PostHog pull request's outcome allows) as a pull request.
   * Never rejects.
   */
  private async runDbt(agentRunId: string): Promise<void> {
    try {
      const row = await this.agentRuns.findOneByOrFail({ id: agentRunId });
      const run = await this.runs.findOneByOrFail({ id: row.runId });
      const ctx = this.contextFor(run);
      const withEvents = row.output?.withEvents === true;
      const plan = (row.output?.items as DbtProposalItem[] | undefined) ?? [];
      const items = plan.filter((item) => itemApplies(item, withEvents));
      const leftOut = new Set(
        plan.filter((item) => !itemApplies(item, withEvents)).map((i) => i.key),
      );
      this.logger.log(
        `dbt agent ${agentRunId.slice(0, 8)} applying ${items.length} of ${plan.length} planned change(s); PostHog events ${withEvents ? 'included' : 'left out'}`,
      );

      const settle = async (pr: boolean, skipped: Set<string>) => {
        const proposed = await this.findings.find({ where: { agentRunId } });
        for (const finding of proposed) {
          const key = finding.payload?.key;
          const k = typeof key === 'string' ? key : null;
          if (k && leftOut.has(k)) {
            await this.findings.update(finding.id, {
              status: 'dropped',
              detail: LEFT_OUT_DETAIL,
            });
          } else {
            await this.findings.update(finding.id, {
              status: pr && !(k && skipped.has(k)) ? 'included' : 'dropped',
            });
          }
        }
      };

      if (items.length === 0) {
        await settle(false, new Set());
        await this.agentRuns.update(agentRunId, {
          status: 'completed',
          finishedAt: new Date(),
          summary:
            'Nothing to change in dbt: every planned change depended on the PostHog events, and their pull request was not merged.',
        });
        return;
      }

      const posthog = withEvents
        ? await this.agentRuns.findOne({
            where: { runId: row.runId, agent: 'posthog_events' },
          })
        : null;
      const mergedPosthogPr: PosthogPrInfo | null =
        posthog?.prNumber != null &&
        posthog.prUrl &&
        posthog.prState === 'merged'
          ? { number: posthog.prNumber, url: posthog.prUrl, state: 'merged' }
          : null;
      const result = await this.dbt.apply(
        ctx,
        items,
        this.sinkFor(agentRunId),
        {
          attempt:
            typeof row.output?.applyAttempts === 'number'
              ? row.output.applyAttempts
              : 1,
          mergedPosthogPr,
        },
      );
      await settle(!!result.pr, new Set(result.skipped.map((s) => s.key)));
      await this.agentRuns.update(agentRunId, {
        status: result.pr ? 'pr_opened' : 'completed',
        finishedAt: new Date(),
        summary: result.summary,
        // The "waiting for CI" note is over; the outcome is in `output.ci`.
        note: null,
      });
      this.logger.log(
        `dbt agent ${agentRunId.slice(0, 8)} finished: ${result.pr ? `PR #${result.pr.number}` : 'no PR opened'}`,
      );
    } catch (err) {
      // A pull request opened before the failure stays recorded on the row.
      this.logger.error(`dbt agent ${agentRunId} failed: ${errorText(err)}`);
      await this.fail(agentRunId, err);
    }
  }

  // ----------------------------------------------------------------- reading

  async listRuns(): Promise<AnalyticsAutomationRunSummaryDto[]> {
    // Nothing else runs on a timer: rows left mid-step by a restart are cleaned here.
    await this.failStale().catch(() => undefined);
    const runs = await this.runs.find({
      order: { ranAt: 'DESC' },
      take: AUTOMATION_LIMITS.HISTORY_LIMIT,
    });
    if (runs.length === 0) return [];
    const agents = await this.agentRuns.find({
      where: { runId: In(runs.map((r) => r.id)) },
    });
    return runs.map((run) => this.summaryDto(run, agents));
  }

  async getRun(id: string): Promise<AnalyticsAutomationRunDetailDto> {
    const run = await this.runs.findOne({ where: { id } });
    if (!run) throw new NotFoundException('Automation run not found');
    const agents = await this.agentRuns.find({ where: { runId: id } });
    // With no poller, an open pull request's badge is refreshed when it is looked at.
    await Promise.all(
      agents
        .filter((a) => a.prState === 'open')
        .map((a) =>
          this.refreshPullRequest(a).catch((err) =>
            this.logger.warn(
              `Could not refresh ${a.prRepo}#${a.prNumber}: ${errorText(err)}`,
            ),
          ),
        ),
    );
    const findings = agents.length
      ? await this.findings.find({
          where: { agentRunId: In(agents.map((a) => a.id)) },
          order: { createdAt: 'ASC' },
        })
      : [];
    return {
      ...this.summaryDto(run, agents),
      commitShas: run.commitShas,
      agentRuns: AGENT_ORDER.map((name) => agents.find((a) => a.agent === name))
        .filter((a): a is AnalyticsAutomationAgentRun => !!a)
        .map((a) =>
          this.agentRunDto(
            a,
            findings.filter((f) => f.agentRunId === a.id),
          ),
        ),
    };
  }

  // ----------------------------------------------------------------- helpers

  private contextFor(run: AnalyticsAutomationRun): AutomationRunContext {
    const repos = resolveAutomationRepos();
    return {
      runId: run.id,
      platform: repos.platform,
      dbt: repos.dbt,
      shas: run.commitShas,
    };
  }

  private sinkFor(agentRunId: string): AutomationPrSink {
    return {
      savePullRequest: async (pr) => {
        await this.agentRuns.update(agentRunId, {
          prRepo: pr.repo,
          prNumber: pr.number,
          prUrl: pr.url,
          prState: 'open',
        });
      },
      saveReview: async (review) => {
        await this.agentRuns.update(agentRunId, {
          reviewVerdict: review.verdict,
          reviewSummary: clip(review.summary, AUTOMATION_LIMITS.MAX_BODY_CHARS),
        });
      },
      // CI progress sits in `output.ci` next to the plan (which it must keep),
      // and while the agent is still working it is also the row's note.
      saveCi: async (ci) => {
        const row = await this.agentRuns.findOneByOrFail({ id: agentRunId });
        const working = ci.state === 'running' || ci.state === 'fixing';
        await this.agentRuns.update(agentRunId, {
          output: jsonb({ ...(row.output ?? {}), ci }),
          note: working ? ci.message : null,
        });
      },
    };
  }

  private async saveFindings(
    agentRunId: string,
    items: AutomationFindingInput[],
  ): Promise<void> {
    if (items.length === 0) return;
    await this.findings.save(
      items.map((item) => this.findings.create({ ...item, agentRunId })),
    );
  }

  private async fail(agentRunId: string, err: unknown): Promise<void> {
    await this.agentRuns
      .update(agentRunId, {
        status: 'failed',
        finishedAt: new Date(),
        note: errorText(err),
      })
      .catch(() => undefined);
  }

  private async requireDbtRow(
    id: string,
  ): Promise<AnalyticsAutomationAgentRun> {
    const row = await this.agentRuns.findOne({ where: { id } });
    if (!row || row.agent !== 'dbt_metrics') {
      throw new NotFoundException('dbt agent run not found');
    }
    return row;
  }

  /**
   * A run still `running` long after it could have finished, and agent runs
   * stuck mid-step, belong to a process that went away. Nothing retries them, so
   * an agent that was waiting, working, analysing or applying is marked failed.
   */
  private async failStale(): Promise<void> {
    const runCutoff = new Date(Date.now() - AUTOMATION_LIMITS.STALE_RUN_MS);
    const agentCutoff = new Date(Date.now() - AUTOMATION_LIMITS.STALE_AGENT_MS);
    await this.runs.update(
      { status: 'running', ranAt: LessThan(runCutoff) },
      { status: 'failed', finishedAt: new Date() },
    );
    await this.agentRuns.update(
      {
        status: In(['waiting', 'running', 'analysing']),
        startedAt: LessThan(agentCutoff),
      },
      {
        status: 'failed',
        finishedAt: new Date(),
        note: 'The process running this agent went away.',
      },
    );
    // `applying` includes the wait for CI and its fix attempts, so it gets longer.
    await this.agentRuns.update(
      {
        status: 'applying',
        startedAt: LessThan(
          new Date(Date.now() - AUTOMATION_LIMITS.STALE_APPLYING_MS),
        ),
      },
      {
        status: 'failed',
        finishedAt: new Date(),
        note: 'The process running this agent went away.',
      },
    );
  }

  private summaryDto(
    run: AnalyticsAutomationRun,
    agents: AnalyticsAutomationAgentRun[],
  ): AnalyticsAutomationRunSummaryDto {
    return {
      id: run.id,
      ranAt: run.ranAt.toISOString(),
      finishedAt: iso(run.finishedAt),
      status: run.status,
      agents: AGENT_ORDER.flatMap((name) => {
        const agent = agents.find(
          (a) => a.runId === run.id && a.agent === name,
        );
        return agent ? [{ agent: name, status: agent.status }] : [];
      }),
    };
  }

  /** One agent run with its findings, read fresh. */
  private async loadAgentDto(
    id: string,
  ): Promise<AnalyticsAutomationAgentRunDto> {
    const row = await this.agentRuns.findOneByOrFail({ id });
    const found = await this.findings.find({
      where: { agentRunId: id },
      order: { createdAt: 'ASC' },
    });
    return this.agentRunDto(row, found);
  }

  private agentRunDto(
    row: AnalyticsAutomationAgentRun,
    findings: AnalyticsAutomationFinding[],
  ): AnalyticsAutomationAgentRunDto {
    const isDbt = row.agent === 'dbt_metrics';
    const retryable = canRetryApply(row);
    return {
      id: row.id,
      agent: row.agent,
      status: row.status,
      startedAt: iso(row.startedAt),
      finishedAt: iso(row.finishedAt),
      summary: row.summary,
      note: row.note,
      output: row.output ?? {},
      pullRequest:
        row.prNumber !== null && row.prRepo && row.prUrl && row.prState
          ? {
              repo: row.prRepo,
              number: row.prNumber,
              url: row.prUrl,
              state: row.prState,
            }
          : null,
      review: row.reviewSummary
        ? { verdict: row.reviewVerdict, summary: row.reviewSummary }
        : null,
      decision: row.decision,
      decidedAt: iso(row.decidedAt),
      canApprove: isDbt && (row.status === 'awaiting_approval' || retryable),
      canReject: isDbt && row.status === 'awaiting_approval',
      findings: findings.map((f) => ({
        id: f.id,
        kind: f.kind,
        title: f.title,
        detail: f.detail,
        payload: f.payload ?? {},
        status: f.status,
      })),
    };
  }
}
