import {
  BadRequestException,
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
import { AnalyticsAutomationRun } from '../entity/analytics-automation-run.entity';
import { clip, evaluateDbtGate } from '../util/analytics-automation.util';
import {
  AutomationPrSink,
  AutomationRunContext,
} from './analytics-automation-agent.base';
import { AnalyticsAutomationBackendReviewAgent } from './analytics-automation-backend-review.agent';
import {
  AnalyticsAutomationDbtAgent,
  DbtProposalItem,
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
 * dbt agent does NOT start with them: it waits for the PostHog agent's pull
 * request to be merged or closed (see `evaluateDbtGate`), which can take days,
 * so an hourly poll refreshes pull request state and releases it when its gate
 * opens. It then writes a proposal and stops at `awaiting_approval`; only a
 * person approving it makes it edit the dbt repo.
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
            trigger: 'scheduled',
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
      await this.releaseDbtIfReady(run.id);
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
   * Starts the dbt agent's analysis if its gate is open, otherwise records why
   * it is still waiting. Safe to call any number of times: the claim below is
   * one atomic update, so only one caller starts the analysis.
   */
  async releaseDbtIfReady(runId: string): Promise<void> {
    const rows = await this.agentRuns.find({ where: { runId } });
    const dbtRow = rows.find((r) => r.agent === 'dbt_metrics');
    if (!dbtRow || dbtRow.status !== 'waiting') return;

    const gate = evaluateDbtGate(
      rows.find((r) => r.agent === 'posthog_events') ?? null,
    );
    if (!gate.open) {
      if (dbtRow.note !== gate.reason) {
        await this.agentRuns.update(dbtRow.id, { note: gate.reason });
      }
      return;
    }

    const claimed = await this.agentRuns.update(
      { id: dbtRow.id, status: 'waiting' },
      { status: 'analysing', startedAt: new Date(), note: gate.note },
    );
    if (!claimed.affected) return;
    void this.analyseDbt(dbtRow.id, gate.withEvents);
  }

  /** Never rejects. */
  private async analyseDbt(
    agentRunId: string,
    withEvents: boolean,
  ): Promise<void> {
    try {
      const row = await this.agentRuns.findOneByOrFail({ id: agentRunId });
      const run = await this.runs.findOneByOrFail({ id: row.runId });
      const posthogRow = await this.agentRuns.findOne({
        where: { runId: row.runId, agent: 'posthog_events' },
      });
      const events = withEvents
        ? ((posthogRow?.output?.events as MergedEvent[] | undefined) ?? [])
        : null;

      const result = await this.dbt.analyse(this.contextFor(run), {
        events,
        rejectedKeys: await this.rejectedKeys(),
      });
      await this.saveFindings(agentRunId, result.findings);
      await this.agentRuns.update(agentRunId, {
        status: result.needsChanges ? 'awaiting_approval' : 'completed',
        finishedAt: result.needsChanges ? null : new Date(),
        summary: result.summary,
        output: jsonb({ items: result.items, withEvents }),
      });
    } catch (err) {
      this.logger.error(`dbt analysis ${agentRunId} failed: ${errorText(err)}`);
      await this.fail(agentRunId, err);
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
   * A person approves the proposal: the dbt agent now edits the dbt repo and
   * opens a pull request, in the background. Allowed from `awaiting_approval`,
   * and again from a `failed` run that was already approved and opened no PR,
   * so a GitHub hiccup does not strand it.
   */
  async approve(
    agentRunId: string,
    userId: number,
  ): Promise<AnalyticsAutomationAgentRunDto> {
    const row = await this.requireDbtRow(agentRunId);
    if (this.proposalItems(row).length === 0) {
      throw new BadRequestException('There is no proposal to approve.');
    }
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
      throw new ConflictException('This proposal cannot be approved now.');
    }
    void this.applyDbt(row.id);
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

  /** Never rejects. */
  private async applyDbt(agentRunId: string): Promise<void> {
    try {
      const row = await this.agentRuns.findOneByOrFail({ id: agentRunId });
      const run = await this.runs.findOneByOrFail({ id: row.runId });
      const result = await this.dbt.apply(
        this.contextFor(run),
        this.proposalItems(row),
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
      this.logger.error(`dbt changes ${agentRunId} failed: ${errorText(err)}`);
      await this.fail(agentRunId, err);
    }
  }

  // ----------------------------------------------------------------- polling

  /**
   * Hourly. Notices that a pull request was merged or closed, and releases any
   * dbt agent whose gate that opens. Starts no run.
   */
  async pollPullRequests(): Promise<void> {
    await this.failStale();

    const open = await this.agentRuns.find({ where: { prState: 'open' } });
    for (const row of open) {
      if (row.prNumber === null || !row.prRepo) continue;
      try {
        const [owner, repo] = row.prRepo.split('/');
        const { state } = await this.github.getPullRequestState(
          { owner, repo },
          row.prNumber,
        );
        if (state !== 'open') {
          await this.agentRuns.update(row.id, { prState: state });
        }
      } catch (err) {
        this.logger.warn(
          `Could not refresh ${row.prRepo}#${row.prNumber}: ${errorText(err)}`,
        );
      }
    }

    const waiting = await this.agentRuns.find({
      where: { agent: 'dbt_metrics', status: 'waiting' },
    });
    for (const row of waiting) {
      await this.releaseDbtIfReady(row.runId).catch((err) =>
        this.logger.warn(`dbt gate check failed: ${errorText(err)}`),
      );
    }
  }

  // ----------------------------------------------------------------- reading

  async listRuns(): Promise<AnalyticsAutomationRunSummaryDto[]> {
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

  private proposalItems(row: AnalyticsAutomationAgentRun): DbtProposalItem[] {
    const items = row.output?.items;
    return Array.isArray(items) ? (items as DbtProposalItem[]) : [];
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
      canApprove:
        isDbt &&
        (row.status === 'awaiting_approval' || retryable) &&
        this.proposalItems(row).length > 0,
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
