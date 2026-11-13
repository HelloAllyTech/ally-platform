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
import { AnalyticsAutomationBackendReviewAgent } from './analytics-automation-backend-review.agent';
import {
  AnalyticsAutomationDbtAgent,
  MergedEvent,
} from './analytics-automation-dbt.agent';
import { AnalyticsAutomationGithubService } from './analytics-automation-github.service';
import {
  AnalyticsAutomationPosthogAgent,
  AutomationFindingInput,
} from './analytics-automation-posthog.agent';

export const AUTOMATION_ALREADY_RUNNING_MESSAGE =
  'An automation run is already in progress.';

/** A run that has been started, and a promise for when its first two agents end. */
export interface StartedAutomationRun {
  run: AnalyticsAutomationRun;
  /** Never rejects: a failure marks the run or the agent `failed`. */
  done: Promise<void>;
}

/** Shown on the dbt agent while it waits for a person: nothing has run. */
const DBT_APPROVAL_NOTE =
  'Nothing has run yet. Approving checks the PostHog pull request on GitHub and then starts the dbt agent.';

const AGENT_ORDER: AnalyticsAutomationAgentName[] = [
  'backend_review',
  'posthog_events',
  'dbt_metrics',
];

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
 * Starting a run takes one snapshot of the platform and dbt heads, then starts
 * two agents together — the backend review and the PostHog events agent. The
 * dbt agent does NOT start with them: it is offered for approval once they
 * finish and does nothing until a person approves it. Approving checks the
 * PostHog pull request on GitHub at that moment (see `evaluateDbtGate`): still
 * open, and the approval is refused; merged or closed, and the agent starts.
 * There is no polling and no timer.
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
    private readonly backendReview: AnalyticsAutomationBackendReviewAgent,
    private readonly posthog: AnalyticsAutomationPosthogAgent,
    private readonly dbt: AnalyticsAutomationDbtAgent,
  ) {}

  // ---------------------------------------------------------------- starting

  /**
   * Registers a run and starts its first two agents in the background. Throws a
   * 409 when a run is already in progress. The heads are read before the row
   * exists, so a GitHub failure leaves no `running` row behind.
   */
  async startScheduledRun(): Promise<StartedAutomationRun> {
    return this.startRun('scheduled');
  }

  /**
   * The same run, started by a person pressing the test button. Only reachable
   * when the controller allows it (`ANALYTICS_AUTOMATION_ALLOW_MANUAL_START`).
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

    // Diff from the last run that got as far as taking a snapshot.
    const previous = await this.runs.findOne({
      where: {},
      order: { ranAt: 'DESC' },
    });
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
            status: 'running',
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
              status: agent === 'dbt_metrics' ? 'waiting' : 'running',
              startedAt: agent === 'dbt_metrics' ? null : ranAt,
              note:
                agent === 'dbt_metrics'
                  ? 'Waiting for the PostHog events agent to finish.'
                  : null,
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

    return { run, done: this.processRun(run) };
  }

  /** Runs the two starting agents together, closes the run, then checks the dbt gate. */
  private async processRun(run: AnalyticsAutomationRun): Promise<void> {
    try {
      const ctx = this.contextFor(run);
      const rows = await this.agentRuns.find({ where: { runId: run.id } });
      const row = (agent: AnalyticsAutomationAgentName) =>
        rows.find((r) => r.agent === agent)!;

      await Promise.allSettled([
        this.runBackendReview(ctx, row('backend_review').id),
        this.runPosthog(ctx, row('posthog_events').id),
      ]);
      await this.runs.update(
        { id: run.id, status: 'running' },
        { status: 'completed', finishedAt: new Date() },
      );
      this.logger.log(`Automation run ${run.id} finished its first two agents`);
      await this.openDbtForApproval(run.id);
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

  private async runBackendReview(
    ctx: AutomationRunContext,
    agentRunId: string,
  ): Promise<void> {
    try {
      const result = await this.backendReview.run(ctx);
      await this.agentRuns.update(agentRunId, {
        status: 'completed',
        finishedAt: new Date(),
        summary: result.summary,
        output: jsonb(result.output),
      });
    } catch (err) {
      this.logger.error(
        `Backend review ${agentRunId} failed: ${errorText(err)}`,
      );
      await this.fail(agentRunId, err);
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
   * Offers the dbt agent for approval once the first two agents are done. It
   * runs NOTHING: the agent starts only when a person approves, and the PostHog
   * pull request is checked on GitHub at that moment, not here. The note says
   * what the pull request looked like when the run finished.
   */
  async openDbtForApproval(runId: string): Promise<void> {
    const rows = await this.agentRuns.find({ where: { runId } });
    const dbtRow = rows.find((r) => r.agent === 'dbt_metrics');
    if (!dbtRow || dbtRow.status !== 'waiting') return;

    const gate = evaluateDbtGate(
      rows.find((r) => r.agent === 'posthog_events') ?? null,
    );
    await this.agentRuns.update(
      { id: dbtRow.id, status: 'waiting' },
      {
        status: 'awaiting_approval',
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
   * A person approves: the dbt agent now starts, in the background. It works out
   * what dbt needs, edits the dbt repo and opens a pull request. Allowed from
   * `awaiting_approval`, and again from a `failed` run that was already approved
   * and opened no PR, so a GitHub hiccup does not strand it.
   */
  async approve(
    agentRunId: string,
    userId: number,
  ): Promise<AnalyticsAutomationAgentRunDto> {
    const row = await this.requireDbtRow(agentRunId);
    const retryable =
      row.status === 'failed' &&
      row.decision === 'approved' &&
      row.prNumber === null;
    if (row.status !== 'awaiting_approval' && !retryable) {
      throw new ConflictException('This agent cannot be approved now.');
    }
    // The gate, on GitHub's answer right now: an open PostHog PR refuses.
    const gate = await this.checkDbtGate(row.runId);
    if (!gate.open) throw new ConflictException(gate.reason);

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
        `("status" = 'awaiting_approval' OR ("status" = 'failed' AND "decision" = 'approved'))`,
      )
      .execute();
    if (!claimed.affected) {
      throw new ConflictException('This agent cannot be approved now.');
    }
    // What the analysis is told about the PostHog events, decided just now.
    await this.agentRuns.update(row.id, {
      output: jsonb({ withEvents: gate.withEvents }),
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
   * What happens after a person approves: work out what dbt needs, then make
   * those changes as a pull request. One background task, so the two steps
   * cannot be started separately. Never rejects.
   */
  private async runDbt(agentRunId: string): Promise<void> {
    try {
      const row = await this.agentRuns.findOneByOrFail({ id: agentRunId });
      const run = await this.runs.findOneByOrFail({ id: row.runId });
      const ctx = this.contextFor(run);
      const withEvents = row.output?.withEvents === true;
      const posthogRow = await this.agentRuns.findOne({
        where: { runId: row.runId, agent: 'posthog_events' },
      });
      const events = withEvents
        ? ((posthogRow?.output?.events as MergedEvent[] | undefined) ?? [])
        : null;

      const analysis = await this.dbt.analyse(ctx, {
        events,
        rejectedKeys: await this.rejectedKeys(),
      });
      // A retry after a failure starts from a clean list.
      await this.findings.delete({ agentRunId });
      if (!analysis.needsChanges) {
        await this.agentRuns.update(agentRunId, {
          status: 'completed',
          finishedAt: new Date(),
          summary: analysis.summary,
          output: jsonb({ items: [], withEvents }),
        });
        return;
      }
      await this.saveFindings(agentRunId, analysis.findings);
      await this.agentRuns.update(agentRunId, {
        summary: analysis.summary,
        output: jsonb({ items: analysis.items, withEvents }),
      });

      const result = await this.dbt.apply(
        ctx,
        analysis.items,
        this.sinkFor(agentRunId),
      );
      const skipped = new Set(result.skipped.map((s) => s.key));
      const proposed = await this.findings.find({ where: { agentRunId } });
      for (const finding of proposed) {
        const key = finding.payload?.key;
        await this.findings.update(finding.id, {
          status:
            result.pr && !(typeof key === 'string' && skipped.has(key))
              ? 'included'
              : 'dropped',
        });
      }
      await this.agentRuns.update(agentRunId, {
        status: result.pr ? 'pr_opened' : 'completed',
        finishedAt: new Date(),
        summary: result.summary,
      });
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
   * stuck mid-step, belong to a process that went away. A stuck analysis goes
   * back to `waiting` (it changed nothing, so it is simply retried); a stuck
   * agent that was working or applying is marked failed.
   */
  private async failStale(): Promise<void> {
    const runCutoff = new Date(Date.now() - AUTOMATION_LIMITS.STALE_RUN_MS);
    const agentCutoff = new Date(Date.now() - AUTOMATION_LIMITS.STALE_AGENT_MS);
    await this.runs.update(
      { status: 'running', ranAt: LessThan(runCutoff) },
      { status: 'failed', finishedAt: new Date() },
    );
    await this.agentRuns.update(
      { status: 'analysing', startedAt: LessThan(agentCutoff) },
      { status: 'waiting' },
    );
    await this.agentRuns.update(
      { status: In(['running', 'applying']), startedAt: LessThan(agentCutoff) },
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
    const retryable =
      row.status === 'failed' &&
      row.decision === 'approved' &&
      row.prNumber === null;
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
