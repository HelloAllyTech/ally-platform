import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
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
  DEBRIEF_APPROVED_PROVIDERS,
  DEBRIEF_SEED_BUNDLE,
  DebriefProvider,
  DebriefStep,
} from '../constants/debrief-release.constants';
import { DebriefRun } from '../entity/debrief-run.entity';
import {
  PROVIDER_ALLOWED_KEY,
  allowlistFromValues,
} from '../util/debrief-provider-allowlist.util';
import { GuideSupportLine } from '../../guide/entity/guide-org-profile.entity';
import { resolveSupportLines } from '../../guide/safety/fixed-responses';
import {
  ScenarioSessionLeaderboardEndedEventParams,
  ScenarioSessionLeaderboardEvent,
} from '../../learn/type/scenario-session-leaderboard-event.type';
import {
  DebriefRunArm,
  DebriefRunMode,
  DebriefRunStatus,
} from '../enum/debrief-run.enum';
import { DebriefRunJudgeService } from './debrief-run-judge.service';
import { DebriefNotifier } from './debrief-notifier.service';
import { DebriefPublishService } from './debrief-publish.service';
import { DebriefTrialsService } from './debrief-trials.service';
import { DebriefReleasesService } from './debrief-releases.service';
import { DebriefPracticeService } from './debrief-practice.service';
import {
  DebriefProgress,
  DebriefRunnerService,
} from './debrief-runner.service';

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
/** Well past the longest deadline (risk cue: 3 min) plus a slow drain. */
const STUCK_AFTER_MINUTES = 10;
/**
 * v9 FR-3: a run still "running" this long is past every deadline (150 s,
 * 180 s with a risk cue), so its worker is gone: resume it, once.
 */
const RESUME_AFTER_MINUTES = 5;
const MAX_RESUMES = 1;

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
  region: {
    type: 'enum',
    enum: ['india', 'outside_india'],
    default: 'india',
    description:
      'Where the organisation works. Outside India there is no default support line, so it needs its own before it can be switched on (v9 FR-25).',
    overridableBy: ['org'],
    group: 'Launch',
  },
  // Plan §8.9 / v9 FR-57 (Q12): an organisation whose contract restricts
  // providers. Not set = allowed; see debrief-provider-allowlist.util.ts.
  ...Object.fromEntries(
    DEBRIEF_APPROVED_PROVIDERS.map((p) => [
      PROVIDER_ALLOWED_KEY(p),
      {
        type: 'boolean',
        default: true,
        description: `This organisation's debriefs may use ${p} models. Off keeps its learners' sessions (live runs, paired trials, Ask Ally) away from ${p}.`,
        overridableBy: ['org'],
        group: 'Providers',
      },
    ]),
  ),
};

export type DebriefRegion = 'india' | 'outside_india';

/** What a learner can read: cards only once published, nothing about the run. */
export interface LearnerDebriefView {
  state: 'ready' | 'working' | 'on_its_way' | 'too_short' | 'not_available';
  runId?: string;
  cards?: Record<string, any> | null;
  language?: string | null;
  steps?: string[];
  /** What the debrief is doing now, as a key the app words (v9 FR-27). */
  progress?: LearnerProgress | null;
  /** The learner stepped out of the role in distress: support comes first. */
  distress?: boolean;
  /** The organisation's support lines (the Guide's), crisis lines first. */
  supportLines?: GuideSupportLine[];
  /** Roleplays the cards link to that the learner can still open. */
  practice?: Array<{ id: number; title: string }>;
}

/** The roleplays a debrief's cards link to, once each. */
function practiceIds(cards?: Record<string, any> | null): number[] {
  const ids = [
    cards?.practise_next?.scenario_id,
    ...(
      (cards?.work_on_this ?? []) as Array<{ scenario_id?: number | null }>
    ).map((c) => c.scenario_id),
  ].filter((id): id is number => id != null);
  return [...new Set(ids.map(Number))];
}

/**
 * Owns when the Debrief agent runs: the 5-minute drain over ended sessions
 * of switched-on tenants (live; while the agent is in development no other
 * organisation's sessions are debriefed automatically — a shadow run is
 * only ever asked for from the Console), the release seed, the
 * tenant switch, and the nightly reconciliation of estimated against actual
 * cost from `llm_usage`.
 */
/**
 * The learner's "working" line (v9 FR-27): specific, never a spinner alone.
 * Keys are worded by the app in the learner's language.
 */
export type LearnerProgress =
  | { key: 'reading' | 'past_sessions' | 'writing' | 'reviewing' | 'care' }
  | { key: 'guidance'; topic?: string }
  | { key: 'revising'; round: number };

export function learnerProgress(
  p: DebriefProgress | undefined,
  hasRiskCue: boolean,
): LearnerProgress | null {
  if (!p?.step) return null;
  switch (p.step) {
    case DebriefStep.GUIDANCE_LOOKUP:
      return p.topic
        ? { key: 'guidance', topic: p.topic }
        : { key: 'guidance' };
    case DebriefStep.PROGRESS_READER:
      return { key: 'past_sessions' };
    case DebriefStep.REVISER:
      return { key: 'revising', round: Math.max(1, p.round ?? 1) };
  }
  // A session with a risk cue gets the careful path; say so.
  if (hasRiskCue) return { key: 'care' };
  switch (p.step) {
    case DebriefStep.WRITER:
      return { key: 'writing' };
    case DebriefStep.CHECKS:
    case DebriefStep.EVALUATOR:
      return { key: 'reviewing' };
    default:
      return { key: 'reading' };
  }
}

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
    private readonly practice: DebriefPracticeService,
    private readonly notifier: DebriefNotifier,
    /** v9 FR-20: a readable live debrief is written where today's was. */
    @Optional() private readonly publisher?: DebriefPublishService,
    /** The PM agent's paired trials and canary (v9 FR-52). */
    @Optional() private readonly trials?: DebriefTrialsService,
    /** Code releases on deploy: live unless they would undo a promoted change. */
    @Optional() private readonly releaseHistory?: DebriefReleasesService,
  ) {}

  /**
   * v9 FR-28: tell the learner their debrief is ready — only for a live run
   * this call just finished (the runner hands back an existing run too).
   */
  private async announceReady(run: DebriefRun): Promise<void> {
    const justFinished =
      run.finishedAt &&
      Date.now() - new Date(run.finishedAt).getTime() < 2 * 60 * 1000;
    if (
      run.mode === DebriefRunMode.LIVE &&
      justFinished &&
      [DebriefRunStatus.PUBLISHED, DebriefRunStatus.BELOW_BAR].includes(
        run.status,
      )
    ) {
      await this.publisher?.applyToSession(run);
      await this.notifier.ready(run);
    }
  }

  onModuleInit(): void {
    // Debrief › Settings › Schedules: when these run is data (debrief_schedules).
    scheduledTaskRegistry.registerConfigurable('debrief-agent-drain', () =>
      this.drain(),
    );
    scheduledTaskRegistry.registerConfigurable(
      'debrief-cost-reconcile',
      async () => {
        await this.reconcileCosts();
      },
    );
    scheduledTaskRegistry.registerConfigurable(
      'debrief-stuck-sweep',
      async () => {
        const resumed = await this.resumeStuckRuns();
        const handed = await this.sweepStuckRuns();
        return resumed + handed === 0
          ? 'none stuck'
          : `${resumed} resumed, ${handed} handed to a person`;
      },
    );
    scheduledTaskRegistry.registerConfigurable('debrief-judge', async () => {
      const n = await this.judge.drain(5);
      return `${n} judged`;
    });
  }

  /**
   * The release in force. The first boot seeds version 1 from code; after
   * that a deploy makes a release only when it changes release contents
   * (default models, settings, recipes): live at once, unless it would undo a
   * promoted change (DebriefReleasesService.fromCodeDefaults). Default prompt
   * texts reach learners through the Skills Store, as a publish does.
   */
  async ensureRelease(): Promise<void> {
    if (!(await this.releases.getGa(DEBRIEF_AGENT_KEY))) {
      await this.releases.syncSeed(
        DEBRIEF_AGENT_KEY,
        DEBRIEF_SEED_BUNDLE as unknown as Record<string, unknown>,
      );
    } else {
      try {
        await this.releaseHistory?.fromCodeDefaults();
      } catch (e) {
        this.logger.warn(
          `[debrief] could not check the code defaults: ${(e as Error).message}`,
        );
      }
    }
    // Plan §8.8: every release records the exact prompt versions it runs.
    try {
      await this.runner.pinAll();
    } catch (e) {
      this.logger.warn(
        `[debrief] could not record release prompt versions: ${(e as Error).message}`,
      );
    }
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
    if (live) await this.requireSupportContact(tenantId);
    await this.overrides.save({
      agentKey: DEBRIEF_AGENT_KEY,
      layer: AgentConfigLayer.ORG,
      scopeId: tenantId,
      schema: DEBRIEF_POLICY,
      change: live ? { set: { live: true } } : { clear: ['live'] },
      actorUserId: userId,
    });
  }

  /** v9 FR-25: where an organisation works; India unless the Ally team says otherwise. */
  async regions(): Promise<Map<string, DebriefRegion>> {
    const rows: Array<{ scopeId: string; region: string }> =
      await this.dataSource.query(
        `SELECT "scopeId", "values"->>'region' AS region FROM agent_config_overrides
          WHERE "agentKey" = $1 AND layer = 'org' AND "values" ? 'region'`,
        [DEBRIEF_AGENT_KEY],
      );
    return new Map(rows.map((r) => [r.scopeId, r.region as DebriefRegion]));
  }

  async setRegion(
    tenantId: string,
    region: DebriefRegion,
    userId: number,
  ): Promise<void> {
    if (
      region === 'outside_india' &&
      (await this.liveTenants()).includes(tenantId) &&
      !(await this.hasOwnSupportLines(tenantId))
    ) {
      throw new BadRequestException(
        'This organisation is switched on and has no support line of its own. Add one in its Ally guide settings first, or switch it off.',
      );
    }
    await this.overrides.save({
      agentKey: DEBRIEF_AGENT_KEY,
      layer: AgentConfigLayer.ORG,
      scopeId: tenantId,
      schema: DEBRIEF_POLICY,
      change: region === 'india' ? { clear: ['region'] } : { set: { region } },
      actorUserId: userId,
    });
  }

  /** Plan §8.9 (FR-57): each organisation's provider allowlist, for those that set one. */
  async providerAllowlists(): Promise<Map<string, DebriefProvider[]>> {
    const rows: Array<{ scopeId: string; values: Record<string, unknown> }> =
      await this.dataSource.query(
        `SELECT "scopeId", "values" FROM agent_config_overrides
          WHERE "agentKey" = $1 AND layer = 'org'`,
        [DEBRIEF_AGENT_KEY],
      );
    return new Map(
      rows.map((r) => [r.scopeId, allowlistFromValues(r.values)] as const),
    );
  }

  /**
   * The owner sets which approved providers an organisation's debriefs may
   * use. At least one: an empty list would stop every debrief, which is what
   * switching the organisation off is for.
   */
  async setProviderAllowlist(
    tenantId: string,
    providers: string[],
    userId: number,
  ): Promise<DebriefProvider[]> {
    const allowed = DEBRIEF_APPROVED_PROVIDERS.filter((p) =>
      providers.includes(p),
    );
    const unknown = providers.filter(
      (p) => !(DEBRIEF_APPROVED_PROVIDERS as readonly string[]).includes(p),
    );
    if (unknown.length) {
      throw new BadRequestException(
        `Not an approved provider: ${unknown.join(', ')}`,
      );
    }
    if (!allowed.length) {
      throw new BadRequestException(
        "Allow at least one provider. To stop this organisation's debriefs, switch it off instead.",
      );
    }
    const set: Record<string, boolean> = {};
    const clear: string[] = [];
    for (const p of DEBRIEF_APPROVED_PROVIDERS) {
      if (allowed.includes(p)) clear.push(PROVIDER_ALLOWED_KEY(p));
      else set[PROVIDER_ALLOWED_KEY(p)] = false;
    }
    await this.overrides.save({
      agentKey: DEBRIEF_AGENT_KEY,
      layer: AgentConfigLayer.ORG,
      scopeId: tenantId,
      schema: DEBRIEF_POLICY,
      change: { set, clear },
      actorUserId: userId,
    });
    return allowed;
  }

  /** Whether the organisation set support lines of its own in its Guide profile. */
  async hasOwnSupportLines(tenantId: string): Promise<boolean> {
    const [row] = await this.dataSource.query(
      `SELECT profile FROM guide_org_profiles WHERE tenant_id = $1`,
      [tenantId],
    );
    const byLanguage = (row?.profile?.supportLines ?? {}) as Record<
      string,
      unknown[]
    >;
    return Object.values(byLanguage).some(
      (lines) => Array.isArray(lines) && lines.length > 0,
    );
  }

  /** v9 FR-25: outside India there is no default line to fall back on. */
  private async requireSupportContact(tenantId: string): Promise<void> {
    const region = (await this.regions()).get(tenantId) ?? 'india';
    if (region === 'india') return;
    if (!(await this.hasOwnSupportLines(tenantId))) {
      throw new BadRequestException(
        'This organisation works outside India, so it needs its own support line before it can be switched on. Add one in its Ally guide settings.',
      );
    }
  }

  async liveTenants(): Promise<string[]> {
    const rows = await this.dataSource.query(
      `SELECT "scopeId" FROM agent_config_overrides
        WHERE "agentKey" = $1 AND layer = 'org' AND ("values"->>'live')::boolean = true`,
      [DEBRIEF_AGENT_KEY],
    );
    return rows.map((r: { scopeId: string }) => r.scopeId);
  }

  /** Ended sessions of the given tenants with messages and no production run yet. */
  async pendingSessions(
    limit: number,
    tenantIds: string[],
  ): Promise<Array<{ id: string; tenant_id: string | null }>> {
    if (tenantIds.length === 0) return [];
    return this.dataSource.query(
      `SELECT s.id, s.tenant_id
         FROM scenario_sessions s
        WHERE ${settledEndedSessionPredicate('s')}
          AND s.tenant_id::text = ANY($3::text[])
          AND s."createdAt" >= now() - make_interval(hours => $1)
          AND s."roomId" NOT LIKE 'preview-%'
          AND s."roomId" NOT LIKE 'seed-room-%'
          AND EXISTS (SELECT 1 FROM scenario_session_messages m
                       WHERE m."scenarioSessionId" = s.id AND m."senderId" <> -1)
          AND NOT EXISTS (SELECT 1 FROM debrief_runs r
                           WHERE r."scenarioSessionId" = s.id AND r.mode IN ('shadow','live'))
        ORDER BY s."endedAt" DESC NULLS LAST
        LIMIT $2`,
      [DRAIN_WINDOW_HOURS, limit, tenantIds],
    );
  }

  /** Start debriefs waiting in switched-on organisations; says what it did, for the run log. */
  async drain(): Promise<string> {
    if (this.config.debriefAgentMode === 'off') return 'Debrief agent is off';
    await this.ensureRelease();
    // Only switched-on organisations: no automatic shadow runs elsewhere.
    const pending = await this.pendingSessions(
      DRAIN_BATCH,
      await this.liveTenants(),
    );
    if (pending.length === 0) {
      const judged = await this.judge.drain(5);
      return judged ? `0 started · ${judged} judged` : '0 started';
    }
    let done = 0;
    await runWithConcurrency(pending, DRAIN_CONCURRENCY, async (s) => {
      const mode = DebriefRunMode.LIVE;
      const run = await this.runner.run(s.id, {
        mode,
        ...(await this.canaryOptions(s.id, mode)),
      });
      await this.announceReady(run);
      // The independent judge scores every debrief, published or not, blind.
      if (run.cards) {
        await this.judge
          .judge(run)
          .catch((e) =>
            this.logger.warn(
              `[debrief] judging run ${run.id} failed: ${(e as Error).message}`,
            ),
          );
        void this.trials?.onPublished(run);
      }
      done++;
      this.logger.info(
        `[debrief] ${mode} run ${run.id} session=${s.id} status=${run.status} rung=${run.fallbackRung}`,
      );
    });
    this.logger.info(`[debrief] drain finished ${done}/${pending.length}`);
    return `${done} started`;
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
        ...(await this.canaryOptions(sessionId, DebriefRunMode.LIVE)),
      });
      await this.announceReady(run);
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
        void this.trials?.onPublished(run);
      }
    } catch (e) {
      this.logger.error(
        `[debrief] live run for session ${sessionId} failed to start: ${(e as Error).message}`,
      );
    }
  }

  /**
   * The sweeper (v9 FR-3): a run still "running" well past every deadline
   * lost its worker — a deploy or a crash. A live one goes to a person to
   * finish (the learner sees "on its way", never an endless progress panel);
   * a shadow or replay one is marked failed. Runs are resumed once first
   * (resumeStuckRuns); this catches the ones that died again, and replays.
   */
  /**
   * v9 FR-52 rung 4: a live debrief in a switched-on organisation runs on the
   * canary release when one is running and the session falls in its share,
   * marked as the canary's challenger arm. Never for shadow runs: the canary
   * is about what learners read. A failed read means no canary.
   */
  private async canaryOptions(
    sessionId: string,
    mode: DebriefRunMode,
  ): Promise<Record<string, unknown>> {
    if (mode !== DebriefRunMode.LIVE || !this.trials) return {};
    const canary = await this.trials.canaryFor(sessionId).catch(() => null);
    return canary
      ? {
          release: canary.release,
          experimentId: canary.ideaId,
          arm: DebriefRunArm.CHALLENGER,
        }
      : {};
  }

  /**
   * v9 FR-3 durable runs: a production run whose worker died mid-run (a
   * deploy, a crash) is resumed once from its checkpoint — the paid steps that
   * finished are replayed, not paid again — with a fresh deadline. Each is
   * claimed by bumping its resume count in one statement, so two replicas
   * never resume the same run. One that dies again goes to the sweeper below.
   */
  async resumeStuckRuns(): Promise<number> {
    const res = await this.dataSource.query(
      `UPDATE debrief_runs
          SET workspace = jsonb_set(coalesce(workspace, '{}'::jsonb), '{resumes}',
                to_jsonb(COALESCE((workspace->>'resumes')::int, 0) + 1)),
              "startedAt" = now(),
              "updatedAt" = now()
        WHERE status = $1
          AND mode IN ('shadow','live')
          AND COALESCE((workspace->>'resumes')::int, 0) < $2
          AND COALESCE("startedAt", "createdAt") < now() - interval '${RESUME_AFTER_MINUTES} minutes'
        RETURNING id`,
      [DebriefRunStatus.RUNNING, MAX_RESUMES],
    );
    const rows: Array<{ id: string }> = Array.isArray(res?.[0])
      ? res[0]
      : (res ?? []);
    for (const { id } of rows) {
      const run = await this.runs.findOne({ where: { id } });
      if (!run) continue;
      try {
        const done = await this.runner.resume(run);
        this.logger.warn(
          `[debrief] resumed stuck ${done.mode} run ${done.id} session=${done.scenarioSessionId} status=${done.status}`,
        );
        await this.announceReady(done);
        if (done.cards) {
          await this.judge.judge(done).catch(() => undefined);
        }
      } catch (e) {
        this.logger.error(
          `[debrief] resuming run ${id} failed: ${(e as Error).message}`,
        );
      }
    }
    return rows.length;
  }

  async sweepStuckRuns(): Promise<number> {
    const res = await this.dataSource.query(
      `UPDATE debrief_runs
          SET status = CASE WHEN mode = 'live' THEN $1 ELSE $2 END,
              "skipReason" = 'stuck',
              "finishedAt" = now(),
              "updatedAt" = now()
        WHERE status = $3
          AND COALESCE("startedAt", "createdAt") < now() - interval '${STUCK_AFTER_MINUTES} minutes'
        RETURNING id, mode`,
      [
        DebriefRunStatus.NEEDS_PERSON,
        DebriefRunStatus.FAILED,
        DebriefRunStatus.RUNNING,
      ],
    );
    const rows = Array.isArray(res?.[0]) ? res[0] : (res ?? []);
    if (rows.length) {
      this.logger.warn(`[debrief] swept ${rows.length} stuck run(s)`);
    }
    return rows.length;
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
          progress: learnerProgress(
            run.workspace?.liveProgress as DebriefProgress | undefined,
            !!run.hasRiskCue,
          ),
        };
      case DebriefRunStatus.PUBLISHED:
      case DebriefRunStatus.BELOW_BAR:
        return {
          state: 'ready',
          runId: run.id,
          cards: run.cards,
          language: run.language,
          distress: run.learnerDistress === true,
          supportLines: await this.supportLines(s.tenant_id, run.language),
          practice: await this.practice.available(
            userId,
            s.tenant_id,
            practiceIds(run.cards),
          ),
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
   * The support lines a learner sees: the organisation's own from its Guide
   * profile for this language, else its English ones, else Tele-MANAS —
   * except outside India, where there is no default.
   */
  async supportLines(
    tenantId: string,
    language?: string | null,
  ): Promise<GuideSupportLine[]> {
    const rows = await this.dataSource.query(
      `SELECT profile FROM guide_org_profiles WHERE tenant_id = $1`,
      [tenantId],
    );
    const lang = (language ?? 'en').split(/[-_]/)[0].toLowerCase() || 'en';
    // Outside India, Tele-MANAS is not a line anyone can call: no default.
    if (
      (await this.regions()).get(tenantId) === 'outside_india' &&
      !(await this.hasOwnSupportLines(tenantId))
    ) {
      return [];
    }
    return resolveSupportLines(rows?.[0]?.profile ?? null, lang);
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
