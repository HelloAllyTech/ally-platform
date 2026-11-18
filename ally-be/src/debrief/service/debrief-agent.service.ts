import { DebriefSlackService } from './debrief-slack.service';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
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
  ALLOWLIST_WHEN_UNREADABLE,
  allowlistFromValues,
} from '../util/debrief-provider-allowlist.util';
import { GuideSupportLine } from '../../guide/entity/guide-org-profile.entity';
import { resolveSupportLines } from '../../guide/safety/fixed-responses';
import {
  ScenarioSessionCompletedEventParams,
  ScenarioSessionCompletionEvent,
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
  DEBRIEF_FALLBACK_TO_TODAY_EVENT,
  DebriefFallbackToTodayEventParams,
  hasLegacyFeedback,
} from '../util/debrief-live.util';
import { todaysDebriefProvider } from '../util/debrief-todays-provider.util';
import { RUN_STATUS_WRITERS } from '../util/debrief-run-status.util';
import { cardsForReader } from '../util/debrief-cards.util';
import { readableCards } from '../util/debrief-competencies.util';
import { DEBRIEF_TIMING } from '../constants/debrief-timing.constants';
import { DebriefChangeHoldsService } from './debrief-change-holds.service';
import {
  DebriefProgress,
  DebriefRunnerService,
} from './debrief-runner.service';

const DRAIN_BATCH = DEBRIEF_TIMING.drainBatch;
const DRAIN_CONCURRENCY = DEBRIEF_TIMING.drainConcurrency;
export const LIVE_START_DELAY_MS = DEBRIEF_TIMING.liveStartDelayMs;
const DRAIN_WINDOW_HOURS = DEBRIEF_TIMING.drainWindowHours;
export const STUCK_AFTER_MINUTES = DEBRIEF_TIMING.stuckAfterMinutes;
export const NO_RUN_GIVE_UP_MINUTES = DEBRIEF_TIMING.noRunGiveUpMinutes;
export const MAX_RETRIES = DEBRIEF_TIMING.maxRetries;
/**
 * Why a live run may end without a draft and be worth running again: a
 * model step failed, it was stuck, or the budget stopped it (before live
 * runs could pass the cap). A failed run (an error) is retried too.
 */
export const RETRYABLE_SKIP_REASONS: ReadonlySet<string> = new Set([
  'safety_reader_failed',
  'writer_failed',
  'stuck',
  'budget_below_minimum',
  'monthly_cap',
]);
/** Skips that are not a missing debrief: nothing to fall back to. */
const NO_FALLBACK_SKIPS: ReadonlySet<string> = new Set([
  'too_short',
  'no_transcript',
  'no_session',
]);
export const REPUBLISH_AFTER_MINUTES = DEBRIEF_TIMING.republishAfterMinutes;
const REPUBLISH_BATCH = DEBRIEF_TIMING.republishBatch;
export const RESUME_AFTER_MINUTES = DEBRIEF_TIMING.resumeAfterMinutes;
const MAX_RESUMES = DEBRIEF_TIMING.maxResumes;

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
  // FR-46: when the organisation was last switched off (epoch ms). After
  // launch, off is an emergency stop: its learners read "not available" for
  // sessions without a debrief already written, never today's debrief.
  stoppedAt: {
    type: 'int',
    default: null,
    nullable: true,
    min: 0,
    description:
      'When this organisation was switched off (an emergency stop). Learners see "not available" for sessions without a debrief already written.',
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
        description: `This organisation's debriefs may use ${p} models. Off keeps its learners' sessions (live debriefs, side-by-side trials, Ask Ally) away from ${p}.`,
        overridableBy: ['org'],
        group: 'Providers',
      },
    ]),
  ),
};

export type DebriefRegion = 'india' | 'outside_india';

/** What a learner can read: cards only once published, nothing about the run. */
export interface LearnerDebriefView {
  state:
    | 'ready'
    | 'working'
    | 'taking_longer'
    | 'on_its_way'
    | 'too_short'
    | 'not_available';
  runId?: string;
  cards?: Record<string, any> | null;
  language?: string | null;
  steps?: string[];
  /** What the debrief is doing now, as a key the app words (v9 FR-27). */
  progress?: LearnerProgress | null;
  /** The learner stepped out of the role in distress: support comes first. */
  distress?: boolean;
  /**
   * The safety reading found a risk cue. The support lines show whenever it
   * did, with or without an important-moment card.
   */
  riskCue?: boolean;
  /** The organisation's support lines (the Guide's), crisis lines first. */
  supportLines?: GuideSupportLine[];
  /**
   * Roleplays the cards link to that the learner can still open. Inside a
   * course, only this same roleplay, with the course item (`trackItemId`)
   * the apps open in the course player: the card reads "Practise this
   * again".
   */
  practice?: Array<{ id: number; title: string; trackItemId?: string }>;
  /**
   * `not_available` only: the tab says "A debrief isn't available for this
   * session" instead of showing today's debrief — the organisation's
   * debriefs were stopped (FR-46), or today's debrief runs on a provider the
   * organisation does not allow (`reason: 'provider_not_allowed'`).
   */
  stopped?: boolean;
  /** `not_available` with `stopped`: why, when it is not an emergency stop. */
  reason?: 'provider_not_allowed';
  /**
   * `ready` only: whether Ask Ally still takes questions. Closed once this
   * debrief's question limit (`session`) or the month's budget (`month`,
   * until the month turns) answered with the limit message, so the apps
   * keep the reply box hidden on reload too.
   */
  askAlly?: { open: boolean; reason?: 'session' | 'month' };
}

/** The IST calendar day, `YYYY-MM-DD`: the owner hears about the cap once a day. */
export function istDay(at: number = Date.now()): string {
  return new Date(at + 330 * 60_000).toISOString().slice(0, 10);
}

/** The IST calendar month, `YYYY-MM`. */
const istMonth = (at: number) => istDay(at).slice(0, 7);

/** Ask Ally's state for a ready debrief, from the run's limit marker. */
export function askAllyState(
  run: Pick<DebriefRun, 'workspace'>,
  now: number = Date.now(),
): { open: boolean; reason?: 'session' | 'month' } {
  const limit = run.workspace?.askAllyLimit as
    | { reason?: string; at?: string }
    | undefined;
  if (limit?.reason === 'session') return { open: false, reason: 'session' };
  if (
    limit?.reason === 'month' &&
    limit.at &&
    istMonth(new Date(limit.at).getTime()) === istMonth(now)
  ) {
    return { open: false, reason: 'month' };
  }
  return { open: true };
}

/** A live run that ended with no draft and may still be run again. */
export function retryPending(run: DebriefRun): boolean {
  return (
    run.mode === DebriefRunMode.LIVE &&
    !run.cards &&
    (run.status === DebriefRunStatus.FAILED ||
      (run.status === DebriefRunStatus.NEEDS_PERSON &&
        RETRYABLE_SKIP_REASONS.has(run.skipReason ?? ''))) &&
    (Number(run.workspace?.retries ?? 0) || 0) < MAX_RETRIES
  );
}

/**
 * "Practise this next" pointing at a roleplay the learner cannot open (none
 * chosen, or one gone) points at this same roleplay instead, when they can
 * open it; otherwise it is left, and the apps offer the roleplays list.
 */
export function withPractiseNextFallback<
  T extends Record<string, any> | null | undefined,
>(
  cards: T,
  available: ReadonlyArray<{ id: number }>,
  thisRoleplay: number | null,
): T {
  const next = cards?.practise_next as
    | { scenario_id?: number | null }
    | null
    | undefined;
  if (!cards || !next) return cards;
  const ids = new Set(available.map((p) => p.id));
  if (next.scenario_id != null && ids.has(Number(next.scenario_id))) {
    return cards;
  }
  if (thisRoleplay == null || !ids.has(thisRoleplay)) return cards;
  return {
    ...cards,
    practise_next: { ...next, scenario_id: thisRoleplay },
  } as T;
}

/**
 * The cards without anything that sends the learner to a roleplay: no
 * practise card and no roleplay link on a Work-on-this card.
 */
export function withoutPractice<
  T extends Record<string, any> | null | undefined,
>(cards: T): T {
  if (!cards) return cards;
  const { practise_next: _drop, ...rest } = cards as Record<string, any>;
  void _drop;
  return {
    ...rest,
    work_on_this: Array.isArray(rest.work_on_this)
      ? rest.work_on_this.map((c: Record<string, any>) => ({
          ...c,
          scenario_id: null,
        }))
      : rest.work_on_this,
  } as unknown as T;
}

/**
 * Whether the character's risk cue(s) bring the support lines on their own: there is a cue, the
 * run's option lets an alarm bring them, and at least one cue is an alarm. Under an option that
 * assesses cues as part of the practice, the Safety reader marks the cues that are that practice
 * (`part_of_practice`): those never bring the lines, every other cue still does. A run with no
 * record of an option (every run before them) behaves as it always did.
 */
export function cueBringsSupportLines(run: {
  hasRiskCue?: boolean | null;
  workspace?: Record<string, any> | null;
}): boolean {
  if (run.hasRiskCue !== true) return false;
  const option = run.workspace?.riskCueOption;
  if (!option) return true;
  if (option.supportLinesOnCue === false) return false;
  if (option.handling !== 'assessed') return true;
  const cues = run.workspace?.safety?.risk_cues;
  if (!Array.isArray(cues) || !cues.length) return true;
  return cues.some(
    (c: { part_of_practice?: unknown }) => c?.part_of_practice !== true,
  );
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
    case DebriefStep.GUIDANCE_AGENT:
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
    /** V2_AUTONOMY A9: pinned languages never join a learner try-out. */
    @Optional() private readonly holds?: DebriefChangeHoldsService,
    /** v2 K3: a debrief shown with a missed clear risk cue goes to the safety contact. */
    @Optional() private readonly slack?: DebriefSlackService,
    /** Asks the session service for today's debrief when the agent's cannot be had. */
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  /**
   * Everything after a run returns, wherever it ran (the drain, on session
   * end, a resume, a retry): the learner is told it is ready, the owner is
   * told when it went past the month's budget, and the judge reads it. A
   * live run that ended with no draft is run again once from the start;
   * one that still has none sends the learner to today's debrief
   * (Gopi, 2026-11-16: "in the worst case fall back to today's debrief").
   */
  async afterRun(run: DebriefRun): Promise<DebriefRun> {
    await this.announceReady(run);
    void this.notifyOverCap(run).catch(() => false);
    if (run.cards) {
      await this.judge
        .judge(run)
        .catch((e) =>
          this.logger.warn(
            `[debrief] judging run ${run.id} failed: ${(e as Error).message}`,
          ),
        );
      void this.trials?.onPublished(run);
      this.postMissedRiskCue(run);
      return run;
    }
    if (run.mode !== DebriefRunMode.LIVE) return run;
    if (retryPending(run)) {
      const again = await this.retryRun(run);
      if (again) return this.afterRun(again);
    }
    if (
      [
        DebriefRunStatus.NEEDS_PERSON,
        DebriefRunStatus.FAILED,
        DebriefRunStatus.SKIPPED,
      ].includes(run.status) &&
      !NO_FALLBACK_SKIPS.has(run.skipReason ?? '')
    ) {
      await this.fallBackToToday(run);
    }
    return run;
  }

  /**
   * Run a live run with no draft again from the start, once. Claimed in one
   * statement (the retry count goes up as the row goes back to running), so
   * two replicas never retry the same run. Null when it was not ours to retry.
   */
  async retryRun(run: DebriefRun): Promise<DebriefRun | null> {
    const res = await this.dataSource.query(
      // A retry starts a fresh attempt, but what the first one spent and when it began are kept
      // (`firstStartedAt`, `priorEstimatedUsd`), so the month's spend and the cost reconcile count it.
      `UPDATE debrief_runs
          SET workspace = jsonb_set(
                jsonb_set(
                  jsonb_set(coalesce(workspace, '{}'::jsonb), '{retries}',
                    to_jsonb(COALESCE((workspace->>'retries')::int, 0) + 1)),
                  '{firstStartedAt}',
                  to_jsonb(COALESCE(workspace->>'firstStartedAt',
                                    COALESCE("startedAt", "createdAt")::text))),
                '{priorEstimatedUsd}',
                to_jsonb(COALESCE((workspace->>'priorEstimatedUsd')::numeric, 0)
                         + COALESCE("estimatedCostUsd", 0))),
              status = $2,
              "startedAt" = now(),
              "finishedAt" = NULL,
              "updatedAt" = now()
        WHERE id = $1 AND mode = 'live' AND cards IS NULL
          AND status IN ($3, $4)
          AND COALESCE((workspace->>'retries')::int, 0) < $5
        RETURNING id`,
      [
        run.id,
        ...RUN_STATUS_WRITERS.retry.to,
        ...RUN_STATUS_WRITERS.retry.from,
        MAX_RETRIES,
      ],
    );
    const rows: Array<{ id: string }> = Array.isArray(res?.[0])
      ? res[0]
      : (res ?? []);
    if (!rows.length) return null;
    const claimed = await this.runs.findOne({ where: { id: run.id } });
    if (!claimed) return null;
    this.logger.warn(
      `[debrief] retrying live run ${run.id} session=${run.scenarioSessionId} (was ${run.status}${run.skipReason ? `/${run.skipReason}` : ''})`,
    );
    try {
      return await this.runner.retry(claimed);
    } catch (e) {
      this.logger.error(
        `[debrief] retrying run ${run.id} failed: ${(e as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Live runs with no draft that the retry on return missed (a run swept as
   * stuck, a restart in between): retried once here. Returns how many.
   */
  async retryFailedRuns(limit = 5): Promise<number> {
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM debrief_runs
        WHERE mode = 'live' AND cards IS NULL
          AND (status = $1 OR (status = $2 AND "skipReason" = ANY($3::text[])))
          AND COALESCE((workspace->>'retries')::int, 0) < $4
          AND "createdAt" >= now() - make_interval(hours => $5)
        ORDER BY "createdAt" LIMIT $6`,
      [
        DebriefRunStatus.FAILED,
        DebriefRunStatus.NEEDS_PERSON,
        [...RETRYABLE_SKIP_REASONS],
        MAX_RETRIES,
        DRAIN_WINDOW_HOURS,
        limit,
      ],
    );
    let n = 0;
    for (const { id } of rows ?? []) {
      const run = await this.runs.findOne({ where: { id } });
      if (!run) continue;
      const again = await this.retryRun(run);
      if (again) {
        n++;
        await this.afterRun(again);
      }
    }
    return n;
  }

  /**
   * Live runs that ended for good with no draft and whose learner was not
   * sent to today's debrief yet (a restart between the two): sent now.
   */
  async fallBackSweep(limit = 20): Promise<number> {
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM debrief_runs
        WHERE mode = 'live' AND cards IS NULL
          AND status IN ($1, $2, $3)
          AND NOT (coalesce("skipReason", '') = ANY($4::text[]))
          AND NOT (coalesce(workspace, '{}'::jsonb) ? 'fallbackToToday')
          AND (status = $3 OR COALESCE((workspace->>'retries')::int, 0) >= $5
               OR NOT (coalesce("skipReason", '') = ANY($6::text[])))
          AND "createdAt" >= now() - make_interval(hours => $7)
        ORDER BY "createdAt" LIMIT $8`,
      [
        DebriefRunStatus.NEEDS_PERSON,
        DebriefRunStatus.FAILED,
        DebriefRunStatus.SKIPPED,
        [...NO_FALLBACK_SKIPS],
        MAX_RETRIES,
        [...RETRYABLE_SKIP_REASONS],
        DRAIN_WINDOW_HOURS,
        limit,
      ],
    );
    let n = 0;
    for (const { id } of rows ?? []) {
      const run = await this.runs.findOne({ where: { id } });
      if (run && !retryPending(run) && (await this.fallBackToToday(run))) n++;
    }
    return n;
  }

  /**
   * Whether today's debrief may be written for this organisation: its model
   * runs on a provider the organisation allows (plan §8.9, FR-57: a
   * learner's data never goes to a provider the organisation does not
   * allow). A failed read allows nothing (fail closed, as the context repository's allowlist does):
   * the learner then sees the defined "not available" state, never a stuck one.
   */
  async todaysDebriefAllowed(tenantId: string | null): Promise<boolean> {
    const provider = todaysDebriefProvider();
    if (!provider || !tenantId) return true;
    try {
      const row = await this.overrides.get(
        DEBRIEF_AGENT_KEY,
        AgentConfigLayer.ORG,
        tenantId,
      );
      return allowlistFromValues(row?.values).includes(provider);
    } catch {
      return ALLOWLIST_WHEN_UNREADABLE.includes(provider);
    }
  }

  /**
   * The learner gets today's debrief instead of the agent's: the session
   * service writes it (it skips sessions of switched-on organisations
   * otherwise). Not when today's debrief runs on a provider the
   * organisation does not allow: the learner reads "not available". Marked
   * on the run once (`workspace.fallbackToToday`). True when this call did it.
   */
  async fallBackToToday(run: DebriefRun): Promise<boolean> {
    const allowed = await this.todaysDebriefAllowed(run.tenantId ?? null);
    const outcome = allowed ? 'today' : 'not_available';
    const res = await this.dataSource.query(
      `UPDATE debrief_runs
          SET workspace = jsonb_set(coalesce(workspace, '{}'::jsonb), '{fallbackToToday}',
                jsonb_build_object('at', now(), 'outcome', $2::text), true)
        WHERE id = $1 AND NOT (coalesce(workspace, '{}'::jsonb) ? 'fallbackToToday')
        RETURNING id`,
      [run.id, outcome],
    );
    const rows = Array.isArray(res?.[0]) ? res[0] : (res ?? []);
    if (!rows.length) return false;
    run.workspace = {
      ...run.workspace,
      fallbackToToday: { at: new Date().toISOString(), outcome },
    };
    this.logger.warn(
      `[debrief] run ${run.id} session=${run.scenarioSessionId} has no draft (${run.status}${run.skipReason ? `/${run.skipReason}` : ''}): ${allowed ? "today's debrief" : "not available (today's provider is not allowed)"}`,
    );
    if (allowed) this.requestTodaysDebrief(run.scenarioSessionId);
    return true;
  }

  /** Asks the session service for today's debrief; it skips one already written. */
  requestTodaysDebrief(sessionId: string): void {
    try {
      this.events?.emit(DEBRIEF_FALLBACK_TO_TODAY_EVENT, {
        scenarioSessionId: sessionId,
      } as DebriefFallbackToTodayEventParams);
    } catch (e) {
      this.logger.warn(
        `[debrief] could not ask for today's debrief for ${sessionId}: ${(e as Error).message}`,
      );
    }
  }

  /**
   * A live run went past the month's budget (Gopi, 2026-11-16: allowed, so
   * the learner gets their debrief): the owner hears once a day, in the app
   * and on Slack when it is set up, with what has been spent. The day is
   * claimed on the run in one statement, so two replicas never both post.
   */
  async notifyOverCap(run: DebriefRun): Promise<boolean> {
    if (!run.workspace?.overCap) return false;
    const day = istDay();
    const res = await this.dataSource.query(
      `UPDATE debrief_runs
          SET workspace = jsonb_set(coalesce(workspace, '{}'::jsonb), '{overCapNotice}',
                jsonb_build_object('day', $2::text, 'at', now()), true)
        WHERE id = $1
          AND NOT EXISTS (SELECT 1 FROM debrief_runs r
                           WHERE r.workspace->'overCapNotice'->>'day' = $2
                             AND r."createdAt" >= now() - interval '2 days')
        RETURNING id`,
      [run.id, day],
    );
    const rows = Array.isArray(res?.[0]) ? res[0] : (res ?? []);
    if (!rows.length) return false;
    const spend = (run.workspace.overCapSpend ?? {}) as {
      spentUsd?: number;
      capUsd?: number;
    };
    const usd = (n?: number) => `$${Number(n ?? 0).toFixed(2)}`;
    const body = `This month's debrief budget (${usd(spend.capUsd)}) is spent: ${usd(spend.spentUsd)} so far. Learners still get their debriefs on the minimum path (writer and checks), so spending is going past the cap. Raise the cap in Debrief › Settings if this is expected.`;
    await this.notifier.owner({
      title: "Debriefs are going past this month's budget",
      body,
    });
    void this.slack?.post(`:money_with_wings: ${body}`).catch(() => false);
    return true;
  }

  /**
   * The Slack post for a missed risk cue. The urgent review itself does not depend on it: the run
   * carries `decision.reviewReason = 'missed_risk_cue'`, which the Console lists first and the
   * overdue notice follows; and a post that failed here is made again by the safety sweep. So a
   * failure is logged at error and never stops the run.
   */
  private postMissedRiskCue(run: DebriefRun): void {
    void Promise.resolve(this.slack?.missedRiskCue(run)).catch((e: Error) =>
      this.logger.error(
        `[debrief] the Slack post for run ${run.id} (a missed risk cue) failed, the safety sweep will try again: ${e.message}`,
      ),
    );
  }

  /**
   * v9 FR-28: tell the learner their debrief is ready — only for a live run
   * this call just finished (the runner hands back an existing run too).
   */
  private async announceReady(run: DebriefRun): Promise<void> {
    const justFinished =
      run.finishedAt &&
      Date.now() - new Date(run.finishedAt).getTime() <
        DEBRIEF_TIMING.announceWithinMs;
    if (
      run.mode === DebriefRunMode.LIVE &&
      justFinished &&
      [DebriefRunStatus.PUBLISHED, DebriefRunStatus.BELOW_BAR].includes(
        run.status,
      )
    ) {
      // The learner reads the debrief from the run's own cards, so "your debrief is ready" does not
      // wait on writing the supervisor note, memory and ready event into the session. If that write
      // fails the run carries no `appliedAt`, and the stuck sweep (`republishUnapplied`) does it again.
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
        const shown = await this.showHeldDrafts();
        const retried = await this.retryFailedRuns();
        const fellBack = await this.fallBackSweep();
        const republished = await this.republishUnapplied();
        return resumed + handed + shown + retried + fellBack + republished === 0
          ? 'none stuck'
          : `${resumed} resumed, ${handed} handed to a person, ${shown} held draft(s) shown, ${retried} retried, ${fellBack} sent to today's debrief, ${republished} published again`;
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
    return (await this.orgSwitch(tenantId)).live;
  }

  /** The tenant switch, and when it was last used as an emergency stop (FR-46). */
  async orgSwitch(
    tenantId: string | null,
  ): Promise<{ live: boolean; stoppedAt: number | null }> {
    if (!tenantId) return { live: false, stoppedAt: null };
    const row = await this.overrides.get(
      DEBRIEF_AGENT_KEY,
      AgentConfigLayer.ORG,
      tenantId,
    );
    const live = row?.values?.live === true;
    const stoppedAt = row?.values?.stoppedAt;
    return {
      live,
      stoppedAt: !live && typeof stoppedAt === 'number' ? stoppedAt : null,
    };
  }

  /** Organisations switched off after being on: an emergency stop (FR-46). */
  async stoppedTenants(): Promise<string[]> {
    const rows = await this.dataSource.query(
      `SELECT "scopeId" FROM agent_config_overrides
        WHERE "agentKey" = $1 AND layer = 'org' AND "values" ? 'stoppedAt'
          AND COALESCE(("values"->>'live')::boolean, false) = false`,
      [DEBRIEF_AGENT_KEY],
    );
    return rows.map((r: { scopeId: string }) => r.scopeId);
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
      // Off is the emergency stop (FR-46): remember when, so learners read
      // "not available" rather than today's debrief.
      change: live
        ? { set: { live: true }, clear: ['stoppedAt'] }
        : { set: { stoppedAt: Date.now() }, clear: ['live'] },
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

  /**
   * Ended sessions of the given tenants with no production run yet. Every
   * ended session gets a run: the runner itself skips one too short to
   * debrief (`too_short`), so the learner reads that, not "working".
   */
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
      try {
        // The independent judge scores every debrief, published or not, blind.
        const run = await this.afterRun(
          await this.runner.run(s.id, {
            mode,
            ...(await this.canaryOptions(s.id, mode)),
          }),
        );
        done++;
        this.logger.info(
          `[debrief] ${mode} run ${run.id} session=${s.id} status=${run.status} rung=${run.fallbackRung}`,
        );
      } catch (e) {
        // A run that could not start (a pinned release that cannot be read) leaves no run row:
        // the next drain starts it again, and the others in this batch carry on.
        this.logger.error(
          `[debrief] ${mode} run for session ${s.id} could not start, will be retried: ${(e as Error).message}`,
        );
      }
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
  @OnEvent(ScenarioSessionCompletionEvent.SCENARIO_SESSION_COMPLETED, {
    async: true,
  })
  async onSessionEnded(
    event: ScenarioSessionCompletedEventParams,
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
      const run = await this.afterRun(
        await this.runner.run(sessionId, {
          mode: DebriefRunMode.LIVE,
          ...(await this.canaryOptions(sessionId, DebriefRunMode.LIVE)),
        }),
      );
      this.logger.info(
        `[debrief] live run ${run.id} session=${sessionId} status=${run.status} rung=${run.fallbackRung} (on session end)`,
      );
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
    if (canary && this.holds) {
      // A pinned language, or a try-out scoped to other languages: this
      // session runs on its own release (the runner reads the pin).
      const idea = await this.dataSource
        .query(`SELECT change FROM agent_lessons WHERE id = $1`, [
          canary.ideaId,
        ])
        .catch(() => []);
      if (
        await this.holds
          .excludesCanary(sessionId, idea?.[0]?.change ?? null)
          .catch(() => false)
      ) {
        return {};
      }
    }
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
        await this.afterRun(done);
      } catch (e) {
        this.logger.error(
          `[debrief] resuming run ${id} failed: ${(e as Error).message}`,
        );
      }
    }
    return rows.length;
  }

  /**
   * A readable live run whose debrief was never written into its session (a crash between the
   * run being saved and the publish, or a publish that failed): publish it again. Every publish
   * write is idempotent. `workspace.appliedAt` is stamped by the publish itself, and a migration
   * stamped every run that already had one, so only runs finished since are ever picked up.
   */
  async republishUnapplied(): Promise<number> {
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM debrief_runs
        WHERE mode = 'live' AND status IN ('published', 'below_bar')
          AND cards IS NOT NULL AND tenant_id IS NOT NULL
          AND "finishedAt" < now() - make_interval(mins => $1)
          AND "finishedAt" >= now() - make_interval(hours => $2)
          AND NOT (coalesce(workspace, '{}'::jsonb) ? 'appliedAt')
        ORDER BY "finishedAt"
        LIMIT $3`,
      [REPUBLISH_AFTER_MINUTES, DRAIN_WINDOW_HOURS, REPUBLISH_BATCH],
    );
    let n = 0;
    for (const { id } of rows ?? []) {
      try {
        const run = await this.runs.findOne({ where: { id } });
        if (run && (await this.publisher?.applyToSession(run))) n++;
      } catch (e) {
        this.logger.error(
          `[debrief] could not publish run ${id} again: ${(e as Error).message}`,
        );
      }
    }
    if (rows?.length) {
      this.logger.warn(
        `[debrief] ${rows.length} run(s) were never written into their session; published ${n} again`,
      );
    }
    return n;
  }

  /**
   * No debrief is held (Gopi, 2026-11-16): a live run waiting for a person
   * that already has a draft is shown as it is — below the bar, still in the
   * review queue — and the learner is told it is ready. Runs held before the
   * graph stopped holding drafts, and any that reach `needs_person` with cards
   * another way, are picked up here. Returns how many were shown.
   */
  async showHeldDrafts(): Promise<number> {
    const res = await this.dataSource.query(
      `UPDATE debrief_runs
          SET status = $1,
              "skipReason" = NULL,
              workspace = jsonb_set(
                coalesce(workspace, '{}'::jsonb), '{decision,reviewReason}',
                to_jsonb(coalesce(workspace->'decision'->>'reviewReason',
                  CASE WHEN "skipReason" = 'checks_failed' THEN 'checks_failed'
                       WHEN coalesce(workspace->'judge'->'hardFails', '[]'::jsonb) @> '[{"code":"missed_risk_cue"}]'
                         OR coalesce(workspace->'decision'->>'why', '') ILIKE '%risk cue%' THEN 'missed_risk_cue'
                       ELSE 'not_evaluated' END)),
                true),
              "updatedAt" = now()
        WHERE mode = 'live' AND status = $2 AND cards IS NOT NULL
          AND NOT (coalesce(workspace, '{}'::jsonb) ? 'review')
          AND coalesce(workspace, '{}'::jsonb) ? 'decision'
        RETURNING id`,
      [
        ...RUN_STATUS_WRITERS.showHeldDraft.to,
        ...RUN_STATUS_WRITERS.showHeldDraft.from,
      ],
    );
    const rows: Array<{ id: string }> = Array.isArray(res?.[0])
      ? res[0]
      : (res ?? []);
    for (const { id } of rows) {
      try {
        const run = await this.runs.findOne({ where: { id } });
        if (!run) continue;
        await this.publisher?.applyToSession(run);
        await this.notifier.ready(run);
        this.postMissedRiskCue(run);
      } catch (e) {
        this.logger.warn(
          `[debrief] could not show held draft ${id}: ${(e as Error).message}`,
        );
      }
    }
    if (rows.length) {
      this.logger.warn(`[debrief] showed ${rows.length} held draft(s)`);
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
        ...RUN_STATUS_WRITERS.sweepStuck.to,
        ...RUN_STATUS_WRITERS.sweepStuck.from,
      ],
    );
    const rows = Array.isArray(res?.[0]) ? res[0] : (res ?? []);
    if (rows.length) {
      this.logger.warn(`[debrief] swept ${rows.length} stuck run(s)`);
    }
    return rows.length;
  }

  /**
   * What the learner sees on the Debrief tab, for their own session only.
   *
   * Never stuck (Gopi, 2026-11-16: "as much as possible the learner should
   * get the debrief; in the worst case fall back to today's debrief"):
   * `working` only while a run is going or about to, `not_available` (the
   * apps show today's debrief) once there is no draft to wait for — the
   * agent is off, the roleplay's Debrief tab is off, no run started within
   * 30 minutes of the session ending, or the run ended with no draft after
   * its retry. Today's debrief is asked for then; when its provider is not
   * one the organisation allows, the tab says "not available" instead.
   */
  async learnerView(
    sessionId: string,
    userId: number,
  ): Promise<LearnerDebriefView> {
    const rows = await this.dataSource.query(
      `SELECT s."counselorId" AS counselor_id, s.tenant_id, s.status,
              COALESCE(s."endedAt", s."updatedAt") AS ended_at,
              (SELECT d.summary->'feedback' FROM scenario_session_details d
                WHERE d."scenarioSessionId" = s.id LIMIT 1) AS feedback,
              (SELECT count(*)::int FROM scenario_session_messages m
                WHERE m."scenarioSessionId" = s.id AND m."senderId" <> -1
                  AND btrim(m.content) <> '') AS learner_turns,
              (SELECT COALESCE(sc.metadata->'feedbackTabs'->>'debrief', '') = 'false'
                 FROM scenarios sc WHERE sc.id = s."scenarioId") AS debrief_tab_off,
              s."scenarioId" AS scenario_id
         FROM scenario_sessions s WHERE s.id = $1`,
      [sessionId],
    );
    const s = rows?.[0];
    if (!s || Number(s.counselor_id) !== Number(userId)) {
      throw new ForbiddenException('Not your session');
    }
    const runs = await this.runs.find({
      where: { scenarioSessionId: sessionId },
    });
    const run = runs.find((r) => r.mode === DebriefRunMode.LIVE);
    // FR-46: an emergency stop stops new debriefs; ones already written stay
    // as they are ("Debriefs already written stay as they are").
    const written =
      !!run?.cards &&
      [DebriefRunStatus.PUBLISHED, DebriefRunStatus.BELOW_BAR].includes(
        run.status,
      );
    if (!written) {
      const org = await this.orgSwitch(s.tenant_id);
      if (!org.live) {
        // FR-46: after an emergency stop the tab says "not available" —
        // except a debrief already written: today's note for a session that
        // ended before the stop stays as it was.
        if (
          org.stoppedAt !== null &&
          !(
            s.ended_at &&
            new Date(s.ended_at).getTime() < org.stoppedAt &&
            hasLegacyFeedback(s.feedback)
          )
        ) {
          return { state: 'not_available', stopped: true };
        }
        return { state: 'not_available' };
      }
      // The agent is switched off platform-wide, or the roleplay shows no
      // Debrief tab: no debrief is coming, so today's.
      if (this.config.debriefAgentMode === 'off' || s.debrief_tab_off) {
        return this.unavailable(sessionId, s, run);
      }
      // Nothing the learner said: say so now, not "working".
      if (s.learner_turns != null && Number(s.learner_turns) === 0) {
        return { state: 'too_short' };
      }
    }
    if (!run || run.status === DebriefRunStatus.QUEUED) {
      // Only a session the drain will still pick up is "working": one
      // debriefed in shadow before the switch, or older than the drain's
      // window, keeps today's debrief rather than waiting forever; so does
      // one no run has started for within 30 minutes of its end.
      const shadowed = runs.some((r) => r.mode === DebriefRunMode.SHADOW);
      const endedAt = s.ended_at ? new Date(s.ended_at).getTime() : null;
      const stillQueued =
        s.status === 'ENDED' &&
        endedAt !== null &&
        Date.now() - endedAt < NO_RUN_GIVE_UP_MINUTES * 60_000;
      if (!shadowed && stillQueued) return { state: 'working' };
      return shadowed
        ? { state: 'not_available' }
        : this.unavailable(sessionId, s, run);
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
      case DebriefRunStatus.BELOW_BAR: {
        // A custom competency's code never reaches the learner, even on a
        // debrief published before the guard (review 2026-11-16).
        const readable = await readableCards(
          this.dataSource,
          cardsForReader(run.cards, run.recipeKey),
        );
        // Inside a course the course decides what comes next: no "Practise
        // this next" or "Practise this again", even on a debrief written
        // before that rule (Gopi, 2026-11-17).
        const read = (await this.practice.inCourse(sessionId))
          ? withoutPractice(readable)
          : readable;
        const thisRoleplay =
          s.scenario_id != null ? Number(s.scenario_id) : null;
        const available = await this.practice.available(
          userId,
          s.tenant_id,
          [
            ...practiceIds(read),
            ...(thisRoleplay != null ? [thisRoleplay] : []),
          ],
          sessionId,
        );
        // "Practise this next" never loses its button: a link the learner
        // cannot open becomes this same roleplay when they can.
        const cards = withPractiseNextFallback(read, available, thisRoleplay);
        const linked = new Set(practiceIds(cards));
        return {
          state: 'ready',
          runId: run.id,
          cards,
          language: run.language,
          distress: run.learnerDistress === true,
          // The safety reading found something. The apps show the support
          // lines on their own when the Writer judged it ordinary low mood or
          // grief and wrote no important moment.
          // Whether a character's cue brings the support lines follows the roleplay's risk-cue
          // option (recorded on the run); the learner's own distress always does.
          riskCue: cueBringsSupportLines(run),
          supportLines: await this.supportLines(s.tenant_id, run.language),
          practice: available.filter((p) => linked.has(p.id)),
          askAlly: askAllyState(run),
        };
      }
      case DebriefRunStatus.SKIPPED:
        return run.skipReason === 'too_short'
          ? { state: 'too_short' }
          : this.unavailable(sessionId, s, run);
      default:
        // A draft waiting for a person is shown as it is within minutes
        // (showHeldDrafts): with a risk cue the learner reads "on its way",
        // otherwise "taking longer" (plan §7.5).
        if (run.cards) {
          return { state: run.hasRiskCue ? 'on_its_way' : 'taking_longer' };
        }
        // No draft yet: it is being run again once (retryPending), then
        // the learner gets today's debrief.
        if (retryPending(run)) return { state: 'working' };
        return this.unavailable(sessionId, s, run);
    }
  }

  /**
   * `not_available`: the apps show today's debrief, which is asked for here
   * when it has not been written (organisations switched on skip it at
   * session end). When today's debrief runs on a provider the organisation
   * does not allow, the tab says "not available" instead (FR-57).
   */
  private async unavailable(
    sessionId: string,
    s: { tenant_id: string | null; feedback: Record<string, unknown> | null },
    run?: DebriefRun | null,
  ): Promise<LearnerDebriefView> {
    if (!(await this.todaysDebriefAllowed(s.tenant_id))) {
      return {
        state: 'not_available',
        stopped: true,
        reason: 'provider_not_allowed',
      };
    }
    if (!hasLegacyFeedback(s.feedback)) {
      if (run && run.mode === DebriefRunMode.LIVE) {
        // Marks the run once; a run already marked asks again only below.
        if (!(await this.fallBackToToday(run).catch(() => false))) {
          this.requestTodaysDebrief(sessionId);
        }
      } else {
        this.requestTodaysDebrief(sessionId);
      }
    }
    return { state: 'not_available' };
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
      `SELECT id, "scenarioSessionId", "finishedAt",
              COALESCE((workspace->>'firstStartedAt')::timestamp, "startedAt") AS "startedAt"
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
