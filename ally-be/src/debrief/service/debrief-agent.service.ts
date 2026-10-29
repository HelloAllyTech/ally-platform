import { ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { AgentReleaseService } from '../../llm-agent/harness/release/agent-release.service';
import { AgentConfigOverrideService } from '../../llm-agent/harness/config/agent-config-override.service';
import { AgentConfigLayer } from '../../llm-agent/harness/enum/harness.enum';
import { PolicySchema } from '../../llm-agent/harness/config/policy-schema';
import { computeCostUsd } from '../../analytics/constants/llm-pricing.constants';
import { settledEndedSessionPredicate } from '../../analytics/util/session-eligibility.util';
import { runWithConcurrency } from '../../analytics/util/judge-concurrency.util';
import {
  DEBRIEF_AGENT_KEY,
  DEBRIEF_SEED_BUNDLE,
} from '../constants/debrief-release.constants';
import { DebriefRun } from '../entity/debrief-run.entity';
import {
  ScenarioSessionLeaderboardEndedEventParams,
  ScenarioSessionLeaderboardEvent,
} from '../../learn/type/scenario-session-leaderboard-event.type';
import { DebriefRunMode, DebriefRunStatus } from '../enum/debrief-run.enum';
import { DebriefRunJudgeService } from './debrief-run-judge.service';
import { DebriefRunnerService } from './debrief-runner.service';

/** Sessions per 5-minute tick; at today's volume the backlog clears in one or two ticks. */
const DRAIN_BATCH = 8;
const DRAIN_CONCURRENCY = 2;
/**
 * How long after a live session ends its debrief starts: long enough for the
 * last turns to land, short enough that the learner is still on the page.
 * The drain is the backstop if this instance restarts in between.
 */
export const LIVE_START_DELAY_MS = 45_000;
/** Only recent sessions: a debrief days late is not what a learner waits for. */
const DRAIN_WINDOW_HOURS = 48;

/** The tenant switch: the only per-org setting the Debrief agent has in v1. */
export const DEBRIEF_POLICY: PolicySchema = {
  live: {
    type: 'boolean',
    default: false,
    description:
      "Learners in this organisation read the Debrief agent's debrief instead of today's.",
    overridableBy: ['org'],
    group: 'Launch',
  },
};

/** What a learner can read: cards only once published, nothing about the run. */
export interface LearnerDebriefView {
  state: 'ready' | 'working' | 'on_its_way' | 'too_short' | 'not_available';
  runId?: string;
  cards?: Record<string, any> | null;
  language?: string | null;
  steps?: string[];
}

/**
 * Owns when the Debrief agent runs: the 5-minute drain over ended sessions
 * (shadow everywhere, live for switched-on tenants), the release seed, the
 * tenant switch, and the nightly reconciliation of estimated against actual
 * cost from `llm_usage`.
 */
@Injectable()
export class DebriefAgentService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(DebriefAgentService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(DebriefRun)
    private readonly runs: Repository<DebriefRun>,
    private readonly runner: DebriefRunnerService,
    private readonly judge: DebriefRunJudgeService,
    private readonly releases: AgentReleaseService,
    private readonly overrides: AgentConfigOverrideService,
    private readonly config: AppConfigService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('5min', 'debrief-agent-drain', () =>
      this.drain(),
    );
    scheduledTaskRegistry.register('daily', 'debrief-cost-reconcile', () =>
      this.reconcileCosts(),
    );
  }

  /** Seed version 1 from code; a deploy never undoes a deliberate rollback. */
  async ensureRelease(): Promise<void> {
    await this.releases.syncSeed(
      DEBRIEF_AGENT_KEY,
      DEBRIEF_SEED_BUNDLE as unknown as Record<string, unknown>,
    );
  }

  async isLive(tenantId: string | null): Promise<boolean> {
    if (!tenantId) return false;
    const row = await this.overrides.get(
      DEBRIEF_AGENT_KEY,
      AgentConfigLayer.ORG,
      tenantId,
    );
    return row?.values?.live === true;
  }

  async setLive(
    tenantId: string,
    live: boolean,
    userId: number,
  ): Promise<void> {
    await this.overrides.save({
      agentKey: DEBRIEF_AGENT_KEY,
      layer: AgentConfigLayer.ORG,
      scopeId: tenantId,
      schema: DEBRIEF_POLICY,
      change: live ? { set: { live: true } } : { clear: ['live'] },
      actorUserId: userId,
    });
  }

  async liveTenants(): Promise<string[]> {
    const rows = await this.dataSource.query(
      `SELECT "scopeId" FROM agent_config_overrides
        WHERE "agentKey" = $1 AND layer = 'org' AND ("values"->>'live')::boolean = true`,
      [DEBRIEF_AGENT_KEY],
    );
    return rows.map((r: { scopeId: string }) => r.scopeId);
  }

  /** Ended sessions with messages and no production run yet. */
  async pendingSessions(
    limit: number,
  ): Promise<Array<{ id: string; tenant_id: string | null }>> {
    return this.dataSource.query(
      `SELECT s.id, s.tenant_id
         FROM scenario_sessions s
        WHERE ${settledEndedSessionPredicate('s')}
          AND s."createdAt" >= now() - make_interval(hours => $1)
          AND s."roomId" NOT LIKE 'preview-%'
          AND s."roomId" NOT LIKE 'seed-room-%'
          AND EXISTS (SELECT 1 FROM scenario_session_messages m
                       WHERE m."scenarioSessionId" = s.id AND m."senderId" <> -1)
          AND NOT EXISTS (SELECT 1 FROM debrief_runs r
                           WHERE r."scenarioSessionId" = s.id AND r.mode IN ('shadow','live'))
        ORDER BY s."endedAt" DESC NULLS LAST
        LIMIT $2`,
      [DRAIN_WINDOW_HOURS, limit],
    );
  }

  async drain(): Promise<void> {
    if (this.config.debriefAgentMode === 'off') return;
    await this.ensureRelease();
    const pending = await this.pendingSessions(DRAIN_BATCH);
    if (pending.length === 0) {
      await this.judge.drain(5);
      return;
    }
    const live = new Set(await this.liveTenants());
    let done = 0;
    await runWithConcurrency(pending, DRAIN_CONCURRENCY, async (s) => {
      const mode =
        s.tenant_id && live.has(s.tenant_id)
          ? DebriefRunMode.LIVE
          : DebriefRunMode.SHADOW;
      const run = await this.runner.run(s.id, { mode });
      // The independent judge scores every debrief, published or not, blind.
      if (run.cards) {
        await this.judge
          .judge(run)
          .catch((e) =>
            this.logger.warn(
              `[debrief] judging run ${run.id} failed: ${(e as Error).message}`,
            ),
          );
      }
      done++;
      this.logger.info(
        `[debrief] ${mode} run ${run.id} session=${s.id} status=${run.status} rung=${run.fallbackRung}`,
      );
    });
    this.logger.info(`[debrief] drain finished ${done}/${pending.length}`);
  }

  /**
   * A learner in a switched-on organisation is waiting on the Debrief tab, so
   * their debrief starts as soon as the session ends instead of at the next
   * drain (which waits for sessions to settle). Shadow runs keep to the drain:
   * nobody is waiting for them.
   */
  @OnEvent(ScenarioSessionLeaderboardEvent.SCENARIO_SESSION_ENDED, {
    async: true,
  })
  async onSessionEnded(
    event: ScenarioSessionLeaderboardEndedEventParams,
  ): Promise<void> {
    if (this.config.debriefAgentMode === 'off') return;
    if (
      !event?.scenarioSessionId ||
      !(await this.isLive(event.tenantId ?? null))
    ) {
      return;
    }
    setTimeout(() => {
      void this.runLiveNow(event.scenarioSessionId);
    }, LIVE_START_DELAY_MS);
  }

  async runLiveNow(sessionId: string): Promise<void> {
    try {
      await this.ensureRelease();
      const run = await this.runner.run(sessionId, {
        mode: DebriefRunMode.LIVE,
      });
      this.logger.info(
        `[debrief] live run ${run.id} session=${sessionId} status=${run.status} rung=${run.fallbackRung} (on session end)`,
      );
      if (run.cards) {
        await this.judge
          .judge(run)
          .catch((e) =>
            this.logger.warn(
              `[debrief] judging run ${run.id} failed: ${(e as Error).message}`,
            ),
          );
      }
    } catch (e) {
      this.logger.error(
        `[debrief] live run for session ${sessionId} failed to start: ${(e as Error).message}`,
      );
    }
  }

  /** What the learner sees on the Debrief tab, for their own session only. */
  async learnerView(
    sessionId: string,
    userId: number,
  ): Promise<LearnerDebriefView> {
    const rows = await this.dataSource.query(
      `SELECT s."counselorId" AS counselor_id, s.tenant_id, s.status,
              COALESCE(s."endedAt", s."updatedAt") AS ended_at
         FROM scenario_sessions s WHERE s.id = $1`,
      [sessionId],
    );
    const s = rows?.[0];
    if (!s || Number(s.counselor_id) !== Number(userId)) {
      throw new ForbiddenException('Not your session');
    }
    if (!(await this.isLive(s.tenant_id))) return { state: 'not_available' };
    const runs = await this.runs.find({
      where: { scenarioSessionId: sessionId },
    });
    const run = runs.find((r) => r.mode === DebriefRunMode.LIVE);
    if (!run || run.status === DebriefRunStatus.QUEUED) {
      // Only a session the drain will still pick up is "on its way": one
      // debriefed in shadow before the switch, or older than the drain's
      // window, keeps today's debrief rather than waiting forever.
      const shadowed = runs.some((r) => r.mode === DebriefRunMode.SHADOW);
      const endedAt = s.ended_at ? new Date(s.ended_at).getTime() : null;
      const stillQueued =
        s.status === 'ENDED' &&
        endedAt !== null &&
        Date.now() - endedAt < DRAIN_WINDOW_HOURS * 3600 * 1000;
      return { state: !shadowed && stillQueued ? 'working' : 'not_available' };
    }
    switch (run.status) {
      case DebriefRunStatus.RUNNING:
        return {
          state: 'working',
          steps: [...new Set(run.steps.map((x) => x.label).filter(Boolean))],
        };
      case DebriefRunStatus.PUBLISHED:
      case DebriefRunStatus.BELOW_BAR:
        return {
          state: 'ready',
          runId: run.id,
          cards: run.cards,
          language: run.language,
        };
      case DebriefRunStatus.SKIPPED:
        return {
          state: run.skipReason === 'too_short' ? 'too_short' : 'not_available',
        };
      default:
        return { state: 'on_its_way' };
    }
  }

  /**
   * Replace each finished run's estimate with what its calls actually cost,
   * from `llm_usage` rows tagged with its session and a debrief step task in
   * the run's time window.
   */
  async reconcileCosts(): Promise<void> {
    const runs: Array<{
      id: string;
      scenarioSessionId: string;
      startedAt: Date;
      finishedAt: Date;
    }> = await this.dataSource.query(
      `SELECT id, "scenarioSessionId", "startedAt", "finishedAt"
         FROM debrief_runs
        WHERE "actualCostUsd" IS NULL AND "finishedAt" IS NOT NULL
          AND "finishedAt" < now() - interval '1 hour'
          AND "finishedAt" > now() - interval '30 days'
        LIMIT 500`,
    );
    for (const r of runs) {
      const usage: Array<{
        model: string;
        promptTokens: number;
        completionTokens: number;
      }> = await this.dataSource.query(
        `SELECT model, "promptTokens", "completionTokens"
           FROM llm_usage
          WHERE "scenarioSessionId" = $1
            AND task LIKE 'debrief\\_%' AND task <> 'debrief_quality_judge'
            AND "occurredAt" BETWEEN $2::timestamp - interval '1 minute'
                                 AND $3::timestamp + interval '5 minutes'`,
        [r.scenarioSessionId, r.startedAt, r.finishedAt],
      );
      const usd = usage.reduce(
        (n, u) =>
          n +
          computeCostUsd(u.model, u.promptTokens ?? 0, u.completionTokens ?? 0)
            .costUsd,
        0,
      );
      await this.runs.update(r.id, { actualCostUsd: usd.toFixed(4) });
    }
    if (runs.length) {
      this.logger.info(`[debrief] reconciled cost for ${runs.length} runs`);
    }
  }
}
