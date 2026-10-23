import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { TokenUser } from 'src/auth/type/auth.types';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';
import { User } from 'src/user/entity/user.entity';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { AgentCostLedgerService } from 'src/llm-agent/harness/budget/agent-cost-ledger.service';
import {
  AgentChannel,
  AgentTurnStatus,
  AgentTurnTrigger,
} from 'src/llm-agent/harness/enum/harness.enum';
import {
  HarnessStage,
  HarnessStageError,
  HarnessStageResult,
  HarnessTurnContext,
  runHarnessStages,
} from 'src/llm-agent/harness/pipeline/harness-turn-runner';
import { AgentReleaseService } from 'src/llm-agent/harness/release/agent-release.service';
import { AgentTraceService } from 'src/llm-agent/harness/trace/agent-trace.service';
import { AgentTurnStoreService } from 'src/llm-agent/harness/turn/agent-turn-store.service';
import { AgentRelease } from 'src/llm-agent/entity/agent-release.entity';
import { AgentMessage } from 'src/llm-agent/type/agent-llm.type';
import { TraceCarrier } from 'src/observability/tracing';
import { GUIDE_TOOLS } from '../capabilities/guide-tools';
import {
  GuideToolContext,
  GuideToolExecutorService,
  TOOL_ACTIVITY,
} from '../capabilities/guide-tool-executor.service';
import { CourseSpine, SpineItem } from '../conductor/course-spine';
import { GuideConductorService } from '../conductor/guide-conductor.service';
import {
  FirstWinPlan,
  GuidanceDial,
  ProseBudget,
  SteerDecision,
  afterDecline,
  afterLearnerTurn,
  afterVerbalSteer,
  atmosphereOf,
  decideSteer,
  planFirstWin,
  proseBudget,
  releaseWindowOpen,
} from '../conductor/pacing';
import {
  SituationInput,
  renderSituationReport,
} from '../conductor/situation-report';
import { GUIDE_AI_TASKS } from '../constants/guide-ai-tasks.constants';
import {
  GuideAtmosphere,
  GuideCard as GuideCardEvent,
} from '../contract/generated/guide-contract';
import {
  CourseContext,
  SystemSpans,
  buildCourseSpan,
  buildEpochOpener,
  buildLearnerMessage,
  buildOrgSpan,
  buildSystemSpans,
} from '../context/guide-context';
import { recentConversation, replayHistory } from '../context/guide-history';
import { GuideLearnerPrefs } from '../entity/guide-learner-prefs.entity';
import { GuideTrigger } from '../entity/guide-trigger.entity';
import { GuideLearnerDataService } from '../learner/guide-learner-data.service';
import {
  GuideOrgProfile,
  GuideOrgProfileValue,
  GuideSupportLine,
} from '../entity/guide-org-profile.entity';
import {
  GuideEpochSnapshot,
  GuideThread,
  GuideThreadPacing,
} from '../entity/guide-thread.entity';
import {
  GuideMessageKind,
  GuideMessageRole,
  GuideMode,
  GuideNotebookKind,
  GuideTriggerStatus,
} from '../enum/guide.enum';
import { guideMessageTooLong } from '../guide-errors';
import {
  ALLY_GUIDE_AGENT_KEY,
  GUIDE_DEFAULT_POLICY,
  GuideBudgetTier,
  GuideReleaseBundle,
} from '../release/guide-release.bundle';
import { GuideCrisisService } from '../safety/guide-crisis.service';
import { GuideSentinelService } from '../safety/guide-sentinel.service';
import { SentinelTurn } from '../prompts/sentinel.prompt';
import {
  DEFAULT_CRISIS_STAY_TEXT,
  urgentRealCaseText,
} from '../safety/fixed-responses';
import {
  CLEAR_VERDICT,
  SentinelOverlay,
  SentinelVerdict,
  isLearnerCrisis,
  isLearnerDistress,
  nextMode,
  sessionStartMode,
} from '../safety/sentinel';
import { GuideSettingsService } from '../settings/guide-settings.service';
import { budgetTier, decideEpoch } from './guide-epoch';
import { GuideEventBusService } from './guide-event-bus.service';
import { GuideModelService } from './guide-model.service';
import { ReleaseGate, runOrchestrator } from './guide-orchestrator.runner';
import { OrchestratorRunOutput } from './guide-orchestrator.runner';
import { GuideThreadService } from './guide-thread.service';

/** One turn at a time per thread; the lock outlives the hard timeout. */
export const GUIDE_TURN_LOCK_PREFIX = 'guide-turn';
export const GUIDE_TURN_LOCK_TTL_SECONDS = 120;
/**
 * A platform turn waits this long for the thread's lock instead of failing:
 * two events from one action (a quiz graded and its item completed) or a
 * learner message in flight must not surface as an error the learner never
 * caused. It matches the turn's hard timeout (plan §7.8).
 */
export const GUIDE_TRIGGER_LOCK_WAIT_MS = 45_000;
const GUIDE_TRIGGER_LOCK_POLL_MS = 500;

/** Tool-calling passes before the closing pass (plan §7.8 step 3). */
export const GUIDE_MAX_TOOL_PASSES = 6;
/** Room for adaptive thinking plus a short reply, per pass. */
export const GUIDE_ORCHESTRATOR_MAX_TOKENS = 8_000;

/** Fixed copy for a model refusal (plan §5.12): kind, with a way forward. */
export const GUIDE_REFUSAL_TEXT =
  "I can't help with that one. Could you put it another way, or shall we " +
  'carry on with the course?';
/** Fixed copy when a turn produced neither words nor a card. */
export const GUIDE_EMPTY_REPLY_TEXT =
  'Sorry, I lost my train of thought there. Could you say that again?';

export type GuideIntent = 'start' | 'continue' | 'locked_peek' | 'not_now';

export interface GuideTurnInput {
  clientTurnId: string;
  text: string;
  intent?: GuideIntent | null;
  anchor?: {
    itemId: string;
    quote?: string | null;
    timestampSec?: number | null;
  } | null;
}

type ReplyKind =
  | 'model'
  | 'crisis'
  | 'urgent_real_case'
  | 'refusal'
  | 'empty'
  /** A spoken reply the learner talked over mid-stream: what they heard. */
  | 'interrupted';

export interface GuideTurnContext extends HarnessTurnContext {
  threadId: string;
  userId: number;
  tenantId: string;
  clientTurnId: string;
  text: string;
  intent: GuideIntent | null;
  anchor: GuideTurnInput['anchor'];
  startedAt: number;
  lastSeq: number;
  lockKey: string;
  locked: boolean;
  ttftMs: number | null;
  usd: number;

  /** The thread as it was before this turn touched it. */
  thread?: GuideThread;
  learnerMessageId?: string;
  learnerSeq?: number;

  releaseId: string | null;
  bundle: GuideReleaseBundle | null;
  tier?: GuideBudgetTier;
  model?: string;
  epoch?: { number: number; snapshot: GuideEpochSnapshot; isNew: boolean };
  mode: GuideMode;
  pacing: GuideThreadPacing;
  guidance: GuidanceDial;
  orgProfile: GuideOrgProfileValue | null;
  course?: CourseContext;
  system?: SystemSpans;
  history: AgentMessage[];
  learnerMessage?: AgentMessage;
  recentTurns: SentinelTurn[];
  steer?: SteerDecision;
  firstWin?: FirstWinPlan;
  atmosphere?: GuideAtmosphere;
  budget?: ProseBudget;
  situationInput?: SituationInput;
  situation?: string;

  verdict?: SentinelVerdict;
  replyKind?: ReplyKind;
  replyMessageId: string;
  replyText?: string;
  replyBlocks?: AgentMessage[];
  learnerRendered?: AgentMessage[];
  interruptedText?: string;
  output?: OrchestratorRunOutput;
  presented: GuideCardEvent[];
  crisis?: {
    text: string;
    language: string;
    approved: boolean;
    lines: GuideSupportLine[];
  };
  overlay: SentinelOverlay;
  restarted: boolean;
  /** Set for a turn a platform event started (no learner words). */
  platformEvent: string | null;
  /** The learner spoke over this turn's reply while it streamed. */
  bargedIn?: boolean;
  /** Reply text already sent to the learner (screen or speaker). */
  releasedText?: string;
  /** turn.started has gone out: the client is waiting for this turn's end. */
  announced?: boolean;
  /** Platform events folded into this turn; consumed if it succeeds. */
  pendingTriggers: GuideTrigger[];
  /** An item was completed since the last turn (steer may present next). */
  justCompleted: boolean;
  memoryEnabled: boolean;
  /** The course item open on screen, if any. */
  openItem?: SpineItem | null;
  channel: 'text' | 'voice';
  /** Voice turns: where spoken text and card hints go, and the barge-in signal. */
  voice?: GuideVoiceSink;
  /** The learner cut the previous voice reply short after this many characters. */
  interrupted?: { turnId: string; spokenChars: number } | null;
}

export interface GuideVoiceSink {
  /** The turn exists: its id goes out first, so a barge-in can name it. */
  onStart?(turnId: string): void;
  /** `crisis` marks the fixed crisis message, spoken slowly (plan §6.3). */
  onDelta(text: string, kind?: 'crisis'): void;
  onCardHint(text: string): void;
  signal: AbortSignal;
}

/**
 * Accepts a learner turn (`202 {turnId}`) and runs it through the harness
 * pipeline in the background; everything the learner sees arrives on the
 * thread's event stream (plans/ally-guide/plan.md §7.8, §9.1).
 *
 *   admit → persist.learner → prepare → respond → persist.reply → finish
 *
 * `prepare` is the Conductor's half: course, epoch, release, mode, pacing and
 * the situation report. `respond` is the model's half, behind the Sentinel:
 * nothing reaches the learner until it clears the message, a crisis is
 * answered with fixed copy and never with generated text, and a change of
 * mode or a real-case overlay restarts the reply once with the right
 * instructions.
 */
@Injectable()
export class GuideTurnService {
  private readonly logger = LoggerService.getInstance(GuideTurnService.name);
  private readonly releaseCache = new Map<string, AgentRelease>();

  constructor(
    private readonly threads: GuideThreadService,
    private readonly bus: GuideEventBusService,
    private readonly turnStore: AgentTurnStoreService,
    private readonly releases: AgentReleaseService,
    private readonly traces: AgentTraceService,
    private readonly settings: GuideSettingsService,
    private readonly redis: RedisService,
    private readonly ledger: AgentCostLedgerService,
    private readonly conductor: GuideConductorService,
    private readonly models: GuideModelService,
    private readonly sentinel: GuideSentinelService,
    private readonly crisis: GuideCrisisService,
    private readonly tools: GuideToolExecutorService,
    @InjectRepository(GuideLearnerPrefs)
    private readonly prefs: Repository<GuideLearnerPrefs>,
    @InjectRepository(GuideOrgProfile)
    private readonly orgProfiles: Repository<GuideOrgProfile>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(GuideTrigger)
    private readonly triggers: Repository<GuideTrigger>,
    private readonly learnerData: GuideLearnerDataService,
  ) {}

  /**
   * Record the turn (idempotent on `clientTurnId`) and start it. A resent
   * request returns the same turn id and does not run it again.
   */
  async accept(
    thread: GuideThread,
    user: TokenUser,
    input: GuideTurnInput,
    traceCarrier?: TraceCarrier,
  ): Promise<{ turnId: string }> {
    const text = (input.text ?? '').trim();
    if (text.length > GUIDE_DEFAULT_POLICY.safety.messageMaxChars) {
      throw guideMessageTooLong(GUIDE_DEFAULT_POLICY.safety.messageMaxChars);
    }
    // Empty text is only meaningful alongside a chip's intent.
    if (!text && !input.intent) {
      throw new BadRequestException('A message or an intent is required');
    }
    const { turn, created } = await this.turnStore.createOrGet({
      agentKey: ALLY_GUIDE_AGENT_KEY,
      threadId: thread.id,
      clientTurnId: input.clientTurnId,
      trigger: input.intent
        ? AgentTurnTrigger.INTENT
        : AgentTurnTrigger.LEARNER_MESSAGE,
      channel: AgentChannel.TEXT,
      tenantId: thread.tenantId ?? null,
    });
    if (created) {
      const ctx = this.createContext(thread, user, input, turn.id);
      ctx.traceCarrier = traceCarrier ?? null;
      setImmediate(() => {
        this.run(ctx).catch((error) =>
          this.logger.error(`Guide turn ${turn.id} crashed`, error),
        );
      });
    }
    return { turnId: turn.id };
  }

  /**
   * A spoken turn from the voice worker (plan §7.9): the same pipeline as a
   * typed one, run to completion while the caller streams what is spoken.
   * Resending a clientTurnId returns the existing turn without running it.
   */
  async runVoiceTurn(
    session: { threadId: string; userId: number; tenantId: string },
    input: {
      clientTurnId: string;
      text: string;
      interruptedTurnId?: string | null;
      spokenChars?: number | null;
    },
    sink: GuideVoiceSink,
  ): Promise<{
    turnId: string;
    messageId: string | null;
    duplicate: boolean;
    failure: GuideTurnContext['failure'];
  }> {
    const text = (input.text ?? '').trim();
    if (!text) throw new BadRequestException('A voice turn needs text');
    if (text.length > GUIDE_DEFAULT_POLICY.safety.messageMaxChars) {
      throw guideMessageTooLong(GUIDE_DEFAULT_POLICY.safety.messageMaxChars);
    }
    const user = {
      id: session.userId,
      tenantId: session.tenantId,
      username: '',
    };
    const thread = await this.threads.getOwned(session.threadId, user);
    // The voice switch is read on every turn, not only when the session
    // opened: flipping it ends open sessions at their next turn (plan E-9).
    if (!(await this.settings.switches()).voice) {
      return {
        turnId: '',
        messageId: null,
        duplicate: false,
        failure: {
          stage: 'admit',
          code: 'guide_disabled',
          message: 'Voice is switched off for Ally.',
        },
      };
    }
    const { turn, created } = await this.turnStore.createOrGet({
      agentKey: ALLY_GUIDE_AGENT_KEY,
      threadId: thread.id,
      clientTurnId: input.clientTurnId,
      trigger: AgentTurnTrigger.LEARNER_MESSAGE,
      channel: AgentChannel.VOICE,
      tenantId: thread.tenantId ?? null,
    });
    if (created) sink.onStart?.(turn.id);
    if (!created) {
      return {
        turnId: turn.id,
        messageId: null,
        duplicate: true,
        failure: undefined,
      };
    }
    const ctx = this.createContext(
      thread,
      user,
      { clientTurnId: input.clientTurnId, text },
      turn.id,
    );
    ctx.channel = 'voice';
    ctx.voice = sink;
    ctx.interrupted =
      input.interruptedTurnId && input.spokenChars != null
        ? { turnId: input.interruptedTurnId, spokenChars: input.spokenChars }
        : null;
    await this.run(ctx);
    return {
      turnId: turn.id,
      messageId: ctx.replyKind ? ctx.replyMessageId : null,
      duplicate: false,
      failure: ctx.failure,
    };
  }

  /** A turn's starting state. Public for tests; `accept` is the entry point. */
  createContext(
    thread: GuideThread,
    user: TokenUser,
    input: GuideTurnInput,
    turnId: string,
  ): GuideTurnContext {
    const text = (input.text ?? '').trim();
    return {
      turnId,
      agentKey: ALLY_GUIDE_AGENT_KEY,
      timings: [],
      conversationId: thread.id,
      threadId: thread.id,
      userId: user.id,
      tenantId: user.tenantId,
      clientTurnId: input.clientTurnId,
      text,
      intent: input.intent ?? null,
      anchor: input.anchor ?? null,
      startedAt: Date.now(),
      lastSeq: thread.lastEventSeq,
      lockKey: `${GUIDE_TURN_LOCK_PREFIX}:${thread.id}`,
      locked: false,
      ttftMs: null,
      usd: 0,
      releaseId: null,
      bundle: null,
      mode: thread.mode ?? GuideMode.NORMAL,
      pacing: thread.pacing ?? {},
      guidance: 'walk',
      orgProfile: null,
      history: [],
      recentTurns: [],
      replyMessageId: randomUUID(),
      presented: [],
      overlay: 'none',
      restarted: false,
      platformEvent: null,
      pendingTriggers: [],
      justCompleted: false,
      memoryEnabled: true,
      channel: 'text',
    };
  }

  /**
   * Start a turn for a platform event while the learner is present
   * (plan §7.8): Ally reacts to a completion as it happens. Idempotent on the
   * trigger's dedupe key. The event is also folded into whichever turn runs
   * next, so if this one loses the lock to a learner message, nothing is lost.
   */
  async acceptTrigger(
    thread: GuideThread,
    user: Pick<TokenUser, 'id' | 'tenantId'>,
    trigger: { dedupeKey: string; description: string },
  ): Promise<{ turnId: string; created: boolean }> {
    const clientTurnId = `trg:${createHash('sha256')
      .update(trigger.dedupeKey)
      .digest('hex')
      .slice(0, 40)}`;
    const { turn, created } = await this.turnStore.createOrGet({
      agentKey: ALLY_GUIDE_AGENT_KEY,
      threadId: thread.id,
      clientTurnId,
      trigger: AgentTurnTrigger.PLATFORM_EVENT,
      channel: AgentChannel.EVENT,
      tenantId: thread.tenantId ?? null,
    });
    if (created) {
      const ctx = this.createContext(
        thread,
        { ...user, username: '' },
        { clientTurnId, text: '' },
        turn.id,
      );
      ctx.platformEvent = trigger.description;
      setImmediate(() => {
        this.run(ctx).catch((error) =>
          this.logger.error(`Guide trigger turn ${turn.id} crashed`, error),
        );
      });
    }
    return { turnId: turn.id, created };
  }

  /**
   * The pipeline, inside the learner's execution context: the course and
   * progress reads are the classic services', which resolve the learner
   * from it, and a turn runs after its HTTP request has already returned.
   */
  async run(ctx: GuideTurnContext): Promise<void> {
    const outcome = await ExecutionManager.runWithContext(
      () => {
        ExecutionManager.setAuthContext(String(ctx.userId), ctx.tenantId);
        return runHarnessStages(ctx, this.stages(), [], {
          onHookError: () => undefined,
        });
      },
      { path: `guide-turn:${ctx.turnId}` },
    );
    this.logger.info(
      `Guide turn ${ctx.turnId} on thread ${ctx.threadId}: ${outcome}` +
        (ctx.replyKind ? ` [${ctx.replyKind}]` : '') +
        (ctx.failure ? ` (${ctx.failure.code} at ${ctx.failure.stage})` : ''),
    );
  }

  private stages(): HarnessStage<GuideTurnContext>[] {
    return [
      { name: 'admit', run: (ctx) => this.admit(ctx) },
      { name: 'persist.learner', run: (ctx) => this.persistLearner(ctx) },
      { name: 'prepare', run: (ctx) => this.prepare(ctx) },
      { name: 'respond', run: (ctx) => this.respond(ctx) },
      { name: 'persist.reply', run: (ctx) => this.persistReply(ctx) },
      { name: 'finish', always: true, run: (ctx) => this.finish(ctx) },
    ];
  }

  // ── admit ──────────────────────────────────────────────────────────────

  private async admit(ctx: GuideTurnContext): Promise<void> {
    const waitUntil = ctx.platformEvent
      ? Date.now() + GUIDE_TRIGGER_LOCK_WAIT_MS
      : 0;
    while (
      !(await this.redis.acquireLock(ctx.lockKey, GUIDE_TURN_LOCK_TTL_SECONDS))
    ) {
      if (Date.now() >= waitUntil) {
        throw new HarnessStageError(
          'turn_in_progress',
          'Ally is replying in another tab.',
        );
      }
      await new Promise((resolve) =>
        setTimeout(resolve, GUIDE_TRIGGER_LOCK_POLL_MS),
      );
    }
    ctx.locked = true;
    const thread = await this.threads.getOwned(ctx.threadId, {
      id: ctx.userId,
      tenantId: ctx.tenantId,
      username: '',
    });
    ctx.thread = thread;
    ctx.mode = thread.mode ?? GuideMode.NORMAL;
    ctx.pacing = { ...(thread.pacing ?? {}) };
    if (
      !(await this.settings.isGuidedAvailable(thread.trackId, ctx.tenantId))
    ) {
      throw new HarnessStageError(
        'guide_disabled',
        'The guide is switched off.',
      );
    }
    await this.turnStore.transition(ctx.turnId, AgentTurnStatus.ADMITTED, {
      startedAt: new Date(ctx.startedAt),
    });
  }

  // ── persist.learner ────────────────────────────────────────────────────

  private async persistLearner(
    ctx: GuideTurnContext,
  ): Promise<HarnessStageResult> {
    if (ctx.platformEvent) {
      // The turn that held the lock may already have folded this event in:
      // then there is nothing left to say, and no note to leave behind.
      const pending = await this.triggers.count({
        where: { threadId: ctx.threadId, status: GuideTriggerStatus.PENDING },
      });
      if (pending === 0) return 'stop';
      // Not the learner's words: a note the model sees, the learner does not.
      const note = await this.threads.appendMessage(
        ctx.threadId,
        ctx.tenantId,
        {
          role: GuideMessageRole.SYSTEM_NOTE,
          content: ctx.platformEvent,
          turnId: ctx.turnId,
          clientTurnId: ctx.clientTurnId,
        },
      );
      ctx.learnerMessageId = note.id;
      ctx.learnerSeq = note.seq;
      await this.bus.emitEphemeral(
        ctx.threadId,
        'turn.started',
        { turnId: ctx.turnId, trigger: 'platform_event' },
        ctx.lastSeq,
      );
      ctx.announced = true;
      await this.presence(ctx, 'thinking', null);
      return;
    }
    const message = await this.threads.appendMessage(
      ctx.threadId,
      ctx.tenantId,
      {
        role: GuideMessageRole.LEARNER,
        channel:
          ctx.channel === 'voice' ? AgentChannel.VOICE : AgentChannel.TEXT,
        content: ctx.text || null,
        turnId: ctx.turnId,
        clientTurnId: ctx.clientTurnId,
        metadata:
          ctx.intent || ctx.anchor
            ? { intent: ctx.intent, anchor: ctx.anchor ?? null }
            : null,
      },
    );
    ctx.learnerMessageId = message.id;
    ctx.learnerSeq = message.seq;
    await this.threads.touchLearnerActivity(ctx.threadId);
    const event = await this.bus.appendDurable(
      ctx.threadId,
      'learner.message',
      {
        messageId: message.id,
        turnId: ctx.turnId,
        clientTurnId: ctx.clientTurnId,
        text: ctx.text,
        channel: ctx.channel,
      },
      ctx.turnId,
    );
    ctx.lastSeq = event.seq;
    await this.bus.emitEphemeral(
      ctx.threadId,
      'turn.started',
      {
        turnId: ctx.turnId,
        trigger: ctx.intent ? 'intent' : 'learner_message',
      },
      ctx.lastSeq,
    );
    ctx.announced = true;
    await this.presence(ctx, 'thinking', null);
  }

  // ── prepare (the Conductor) ────────────────────────────────────────────

  private async prepare(ctx: GuideTurnContext): Promise<void | 'stop'> {
    const thread = ctx.thread!;
    const now = new Date();

    const [prefsRow, orgRow, user, course, ga] = await Promise.all([
      this.prefs.findOne({
        where: { userId: ctx.userId, tenantId: ctx.tenantId },
      }),
      this.orgProfiles.findOne({ where: { tenantId: ctx.tenantId } }),
      this.users.findOne({
        where: { id: ctx.userId },
        select: { id: true, name: true },
      }),
      this.conductor.loadCourse(thread.trackId),
      this.releases.getGa(ALLY_GUIDE_AGENT_KEY),
    ]);
    if (!ga) {
      throw new HarnessStageError(
        'guide_disabled',
        'Ally has no live release.',
      );
    }
    ctx.course = course;
    ctx.orgProfile = orgRow?.profile ?? null;
    ctx.guidance = prefsRow?.prefs?.guidance ?? 'walk';
    ctx.memoryEnabled = prefsRow?.prefs?.memoryEnabled !== false;

    // The release this epoch is pinned to, if the epoch can continue.
    const snapshot = thread.epochSnapshot ?? null;
    const pinned = snapshot?.releaseId
      ? await this.releaseById(snapshot.releaseId)
      : null;
    const candidate = pinned ?? ga;
    const candidateBundle = candidate.bundle as unknown as GuideReleaseBundle;

    const [threadUsd, learnerDayUsd, emergencyId] = await Promise.all([
      this.ledger.totalForThread(ALLY_GUIDE_AGENT_KEY, ctx.threadId),
      this.ledger.totalForUserWithin(
        ALLY_GUIDE_AGENT_KEY,
        ctx.userId,
        24 * 60 * 60 * 1000,
      ),
      this.releases.lastEmergencyRollbackId(ALLY_GUIDE_AGENT_KEY),
    ]);
    const tier = budgetTier({
      threadUsd,
      learnerDayUsd,
      limits: candidateBundle.policy.limits,
    });

    const orgSpan = buildOrgSpan(ctx.orgProfile);
    const courseSpan = buildCourseSpan(course);
    const pinnedSpans = buildSystemSpans(candidateBundle, orgSpan, courseSpan);
    const decision = decideEpoch({
      snapshot,
      now,
      lastLearnerActivityAt: thread.lastLearnerActivityAt ?? null,
      idleMinutes: candidateBundle.policy.epochIdleMinutes,
      emergencyRollbackId: emergencyId,
      tier,
      spanHashes: pinnedSpans.hashes,
    });

    let release: AgentRelease;
    let spans: SystemSpans;
    let epochOpener: string | null = null;
    if (decision.continue) {
      release = candidate;
      spans = pinnedSpans;
      const rows = await this.threads.historyRows(
        ctx.threadId,
        snapshot!.startSeq ?? 0,
        ctx.learnerSeq!,
      );
      ctx.history = replayHistory(rows);
      ctx.epoch = { number: thread.epoch, snapshot: snapshot!, isNew: false };
    } else {
      release = ga;
      const bundle = ga.bundle as unknown as GuideReleaseBundle;
      spans = buildSystemSpans(bundle, orgSpan, courseSpan);
      const route = this.models.route(
        bundle,
        'orchestrator',
        ctx.channel,
        tier,
      );
      ctx.history = [];
      ctx.epoch = {
        number: thread.epoch + 1,
        isNew: true,
        snapshot: {
          releaseId: ga.id,
          model: route.model,
          tier,
          layerHashes: spans.hashes,
          startedAt: now.toISOString(),
          reason: decision.reason,
          startSeq: ctx.learnerSeq,
          emergencyRollbackId: emergencyId,
        },
      };
      const recent = await this.threads.recentRows(
        ctx.threadId,
        ctx.learnerSeq!,
        12,
      );
      const memories = ctx.memoryEnabled
        ? await this.learnerData.activeMemories(
            { id: ctx.userId, tenantId: ctx.tenantId },
            bundle.policy.memory.maxNotesInContext,
          )
        : [];
      epochOpener = buildEpochOpener({
        firstName: user?.name?.trim().split(/\s+/)[0] || null,
        guidance: ctx.guidance,
        recent: recentConversation(recent, 6),
        reason: decision.reason,
        memories: memories.map((memory) => ({
          kind: memory.kind,
          body: memory.body,
        })),
      });
      if (
        decision.reason === 'first conversation' ||
        decision.reason === 'return after a break'
      ) {
        const start = sessionStartMode({
          current: ctx.mode,
          lastCrisisAt: await this.crisis.lastCrisisAt(ctx.userId),
          now,
          followupDays: bundle.policy.safety.crisisFollowupDays,
        });
        ctx.mode = start.mode;
      }
    }

    const bundle = release.bundle as unknown as GuideReleaseBundle;
    ctx.releaseId = release.id;
    ctx.bundle = bundle;
    ctx.tier = tier;
    ctx.model = this.models.route(
      bundle,
      'orchestrator',
      ctx.channel,
      tier,
    ).model;
    ctx.system = spans;
    const policy = bundle.policy;

    // Platform events since the last turn (completions here or in classic)
    // are folded into this one as data the model can see.
    ctx.pendingTriggers = await this.triggers.find({
      where: { threadId: ctx.threadId, status: GuideTriggerStatus.PENDING },
      order: { createdAt: 'ASC' },
      take: 10,
    });
    if (ctx.platformEvent && ctx.pendingTriggers.length === 0) {
      // Another turn already folded this event in: nothing left to say.
      return 'stop';
    }
    ctx.justCompleted = ctx.pendingTriggers.some(
      (trigger) => trigger.kind === 'item_completed',
    );

    // The learner's turn moves the pacing state before anything is decided.
    let pacing: GuideThreadPacing = { ...ctx.pacing };
    if (pacing.fadeLevel == null) pacing.fadeLevel = policy.fade.start.lay;
    const onSpine =
      Boolean(ctx.anchor) ||
      ctx.intent === 'start' ||
      ctx.intent === 'continue' ||
      ctx.intent === 'locked_peek';
    if (!ctx.platformEvent) pacing = afterLearnerTurn(pacing, onSpine);
    if (ctx.intent === 'not_now') pacing = afterDecline(pacing);
    ctx.pacing = pacing;

    const spine = course.spine;
    // What is open on screen: Ally stays quiet over an item, and only points
    // to material while a quiz is open (plan §6.4).
    const openCard = await this.threads.openItemCard(ctx.threadId);
    const openItem = openCard
      ? (spine.items.find((item) => item.id === openCard.trackItemId) ?? null)
      : null;
    ctx.openItem = openItem;
    const steer = decideSteer({
      mode: ctx.mode,
      pacing,
      spine,
      policy,
      now: Date.now(),
      learnerReady: ctx.intent === 'start' || ctx.intent === 'continue',
      justCompleted: ctx.justCompleted,
      itemOpen: Boolean(openItem) && openItem!.state !== 'completed',
    });
    const windowOpen = releaseWindowOpen(pacing, policy.releaseWindowMaxTurns);
    ctx.steer = steer;
    ctx.firstWin = planFirstWin(spine, pacing);
    ctx.atmosphere = atmosphereOf({
      mode: ctx.mode,
      releaseWindowOpen: windowOpen,
      spine,
    });
    ctx.budget = proseBudget(
      ctx.guidance,
      ctx.channel,
      pacing.fadeLevel,
      policy,
    );

    const events: string[] = [];
    if (ctx.epoch.isNew && ctx.mode === GuideMode.CRISIS_FOLLOWUP) {
      events.push(
        'This is the first conversation since a hard moment. Open with a brief, ' +
          'gentle check-in on how they are today, before anything else.',
      );
    }
    if (ctx.interrupted) {
      const heard = await this.threads.markReplyInterrupted(
        ctx.threadId,
        ctx.interrupted.turnId,
        ctx.interrupted.spokenChars,
      );
      if (heard !== null) {
        events.push(
          `The learner spoke over your last reply; they heard only: "${heard}". ` +
            'Do not repeat the rest unless they ask.',
        );
      }
    }

    // After the first win, once: ask what kind of helper they want to become
    // (plan §3 stage 6) — never before the win, never in a hard moment.
    const won = Boolean(pacing.firstWinAt) || spine.completed > 0;
    if (
      won &&
      ctx.mode === GuideMode.NORMAL &&
      pacing.possibleSelfOfferedAtTurn == null &&
      !(await this.learnerData.hasNotebookKind(
        { id: ctx.userId, tenantId: ctx.tenantId },
        thread.trackId,
        GuideNotebookKind.POSSIBLE_SELF,
      ))
    ) {
      events.push(
        'They have had a first win. When it fits naturally — not as an interruption — ' +
          'ask once what kind of helper they want to become. Only after they answer, ' +
          'in a later turn, save their words with save_to_notebook (possible_self) and ' +
          'remember (possible_self). Never answer it for them.',
      );
      pacing = {
        ...pacing,
        possibleSelfOfferedAtTurn: pacing.learnerTurns ?? 0,
      };
      ctx.pacing = pacing;
    }

    // A card for the next step still in view from this sitting: say so, so
    // "continue" points at it instead of stacking a duplicate.
    const epochStartedAt = ctx.epoch?.snapshot?.startedAt ?? null;
    const nextOnScreen =
      !openItem && spine.current
        ? Boolean(
            await this.threads.liveItemCard(
              ctx.threadId,
              spine.current.id,
              epochStartedAt,
            ),
          )
        : false;

    ctx.situationInput = {
      turn: pacing.learnerTurns ?? 1,
      mode: ctx.mode,
      atmosphere: ctx.atmosphere,
      channel: ctx.channel,
      guidance: ctx.guidance,
      budget: ctx.budget,
      steer,
      spine,
      firstWin: ctx.firstWin,
      releaseWindowOpen: windowOpen,
      overlay: 'none',
      events,
      openItem: openItem
        ? { id: openItem.id, title: openItem.title, type: openItem.type }
        : null,
      quizOpen: openItem?.type === 'QUIZ' && openItem.state !== 'completed',
      nextOnScreen,
      platformTurn: Boolean(ctx.platformEvent) && !ctx.text.trim(),
      continuePressed: ctx.intent === 'start' || ctx.intent === 'continue',
    };
    ctx.situation = renderSituationReport(ctx.situationInput);
    ctx.learnerMessage = buildLearnerMessage({
      text: ctx.text,
      intent: ctx.intent,
      anchor: ctx.anchor,
      epochOpener,
      platformEvents: ctx.pendingTriggers.map((trigger) =>
        String(trigger.payload?.description ?? trigger.kind),
      ),
    });
    const recent = await this.threads.recentRows(
      ctx.threadId,
      ctx.learnerSeq!,
      6,
    );
    ctx.recentTurns = recentConversation(recent, 6).map((line) => ({
      role: line.role,
      text: line.text,
    }));
    await this.turnStore.transition(ctx.turnId, AgentTurnStatus.STREAMING, {
      releaseId: ctx.releaseId,
    });
  }

  private async releaseById(id: string): Promise<AgentRelease | null> {
    const cached = this.releaseCache.get(id);
    if (cached) return cached;
    try {
      const release = await this.releases.getById(id);
      this.releaseCache.set(id, release);
      return release;
    } catch {
      return null;
    }
  }

  // ── respond (the model, behind the Sentinel) ───────────────────────────

  private async respond(ctx: GuideTurnContext): Promise<void> {
    const bundle = ctx.bundle!;
    const policy = bundle.policy;
    const attribution = {
      threadId: ctx.threadId,
      turnId: ctx.turnId,
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      releaseId: ctx.releaseId,
    };

    // Layer 1, synchronously: a first-person crisis never reaches a model.
    const keyword = ctx.text ? this.sentinel.keyword(ctx.text) : null;
    if (keyword) {
      ctx.verdict = keyword;
      await this.respondWithCrisis(ctx, 'keyword');
      return;
    }

    const verdictPromise: Promise<SentinelVerdict | null> = ctx.text
      ? this.sentinel.assess({
          text: ctx.text,
          recentTurns: ctx.recentTurns,
          item: this.sentinelItem(ctx.course!.spine),
          bundle,
          attribution,
        })
      : Promise.resolve(null);

    // In CRISIS the model stays silent until the Sentinel has read the new
    // message (plan §6.3 step 5): wait for the verdict before generating.
    let verdictApplied = false;
    if (ctx.mode === GuideMode.CRISIS && ctx.text) {
      const verdict = await verdictPromise;
      if (verdict) ctx.verdict = verdict;
      if (verdict && isLearnerCrisis(verdict)) {
        await this.respondWithCrisis(ctx, verdict.source);
        return;
      }
      if (verdict?.overlay === 'real_case_urgent') {
        await this.respondWithFixed(
          ctx,
          'urgent_real_case',
          urgentRealCaseText(ctx.orgProfile),
          [ctx.learnerMessage!],
        );
        return;
      }
      const change = nextMode(ctx.mode, verdict ?? CLEAR_VERDICT);
      ctx.mode = change.mode;
      ctx.overlay =
        verdict?.overlay === 'real_case' || verdict?.overlay === 'pii'
          ? verdict.overlay
          : 'none';
      this.refreshSituation(ctx);
      verdictApplied = true;
    }

    let pending: 'crisis' | 'urgent' | 'restart' | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      pending = null;
      const controller = new AbortController();
      // A voice barge-in ends the turn; what was already spoken is kept.
      const onBargeIn = () => {
        ctx.bargedIn = true;
        controller.abort('barge-in');
      };
      ctx.voice?.signal.addEventListener('abort', onBargeIn, { once: true });
      if (ctx.voice?.signal.aborted) controller.abort('barge-in');
      const hardTimeout = setTimeout(
        () => controller.abort('turn timeout'),
        policy.limits.turnHardTimeoutMs,
      );
      const gate = new ReleaseGate(async (text) => {
        if (ctx.ttftMs === null) {
          ctx.ttftMs = Date.now() - ctx.startedAt;
          await this.presence(ctx, 'speaking', null);
        }
        ctx.voice?.onDelta(text);
        await this.bus.emitEphemeral(
          ctx.threadId,
          'assistant.delta',
          { turnId: ctx.turnId, messageId: ctx.replyMessageId, text },
          ctx.lastSeq,
        );
      });

      const decide = async (verdict: SentinelVerdict | null) => {
        if (verdict) ctx.verdict = verdict;
        if (!verdict) return gate.release();
        if (isLearnerCrisis(verdict)) {
          pending = 'crisis';
          gate.discard();
          controller.abort('crisis');
          return;
        }
        if (verdict.overlay === 'real_case_urgent') {
          pending = 'urgent';
          gate.discard();
          controller.abort('urgent real case');
          return;
        }
        const change = nextMode(ctx.mode, verdict);
        const overlay =
          verdict.overlay === 'real_case' || verdict.overlay === 'pii'
            ? verdict.overlay
            : 'none';
        const needsNewInstructions = change.changed || overlay !== ctx.overlay;
        if (needsNewInstructions && !gate.releasedText && attempt === 0) {
          ctx.mode = change.mode;
          ctx.overlay = overlay;
          pending = 'restart';
          gate.discard();
          controller.abort('restart with new instructions');
          return;
        }
        // Too late to restart: the reply goes out, the mode applies next turn.
        if (change.changed) ctx.mode = change.mode;
        await gate.release();
      };

      // The first attempt waits for the verdict up to the deadline; a restart
      // already has it.
      let deadline: NodeJS.Timeout | undefined;
      if (attempt === 0 && !verdictApplied) {
        deadline = setTimeout(() => {
          if (!ctx.verdict) void gate.release();
        }, policy.safety.sentinelDeadlineMs);
        void verdictPromise.then(decide);
      } else {
        await gate.release();
      }

      try {
        ctx.output = await runOrchestrator({
          system: ctx.system!.blocks,
          messages: [
            ...ctx.history,
            ctx.learnerMessage!,
            { role: 'system', content: ctx.situation! },
          ],
          tools: GUIDE_TOOLS,
          maxTokens: GUIDE_ORCHESTRATOR_MAX_TOKENS,
          maxPasses: GUIDE_MAX_TOOL_PASSES,
          signal: controller.signal,
          gate,
          stream: (request) =>
            this.models.stream({
              role: 'orchestrator',
              bundle,
              channel: ctx.channel,
              tier: ctx.tier,
              task: LlmTask.GUIDE_ORCHESTRATOR,
              aiTaskId: GUIDE_AI_TASKS.ORCHESTRATOR,
              attribution,
              request,
              onCost: (usd) => {
                ctx.usd += usd;
              },
            }),
          executeTool: (name, input) =>
            this.tools.execute(name, input, this.toolContext(ctx)),
          onToolStart: (name) => {
            void this.toolActivity(ctx, name);
          },
        });
      } finally {
        ctx.releasedText = gate.releasedText;
        clearTimeout(hardTimeout);
        if (deadline) clearTimeout(deadline);
        ctx.voice?.signal.removeEventListener('abort', onBargeIn);
      }

      // A verdict still outstanding is awaited now: the reply may have
      // finished first, and a late crisis still gets the fixed response.
      if (attempt === 0 && !verdictApplied && !ctx.verdict && ctx.text) {
        await verdictPromise.then(decide);
      }
      if (pending === 'restart') {
        ctx.restarted = true;
        this.refreshSituation(ctx);
        ctx.presented = [];
        continue;
      }
      break;
    }

    const output = ctx.output!;
    if (pending === 'crisis') {
      ctx.interruptedText = output.aborted ? undefined : output.text;
      await this.respondWithCrisis(ctx, ctx.verdict?.source ?? 'classifier');
      return;
    }
    if (pending === 'urgent') {
      await this.respondWithFixed(
        ctx,
        'urgent_real_case',
        urgentRealCaseText(ctx.orgProfile),
        [ctx.learnerMessage!],
      );
      return;
    }
    if (output.aborted && ctx.bargedIn && ctx.releasedText?.trim()) {
      // The learner heard part of this reply and spoke over it. Keep what
      // was sent as plain text — no half pass, no thinking — so the next
      // turn's interruptedTurnId/spokenChars can trim it to what they heard
      // and the model sees it (plan §11 F-2). Tools that already ran stay
      // visible as their cards.
      ctx.replyKind = 'interrupted';
      ctx.replyText = ctx.releasedText.trim();
      ctx.learnerRendered = [
        ctx.learnerMessage!,
        { role: 'system', content: ctx.situation! },
      ];
      ctx.replyBlocks = [
        { role: 'assistant', content: [{ type: 'text', text: ctx.replyText }] },
      ];
      return;
    }
    if (output.aborted) {
      throw new HarnessStageError('interrupted', 'The reply was cut off.');
    }
    if (output.refusal) {
      await this.respondWithFixed(ctx, 'refusal', GUIDE_REFUSAL_TEXT, [
        ctx.learnerMessage!,
        { role: 'system', content: ctx.situation! },
      ]);
      return;
    }
    if (!output.text.trim() && ctx.presented.length === 0) {
      await this.respondWithFixed(ctx, 'empty', GUIDE_EMPTY_REPLY_TEXT, [
        ctx.learnerMessage!,
        { role: 'system', content: ctx.situation! },
      ]);
      return;
    }
    ctx.replyKind = 'model';
    ctx.replyText = output.text.trim();
    ctx.learnerRendered = [
      ctx.learnerMessage!,
      { role: 'system', content: ctx.situation! },
    ];
    ctx.replyBlocks = output.appended.length
      ? output.appended
      : [
          {
            role: 'assistant',
            content: [{ type: 'text', text: ctx.replyText }],
          },
        ];
    if (ctx.steer?.level === 2) ctx.pacing = afterVerbalSteer(ctx.pacing);
    if (ctx.presented.some((card) => card.kind === 'course_item')) {
      ctx.pacing = { ...ctx.pacing, offSpineTurns: 0 };
    }
  }

  /** Re-derive steer, atmosphere and the report after the mode or overlay moved. */
  private refreshSituation(ctx: GuideTurnContext): void {
    const policy = ctx.bundle!.policy;
    const spine = ctx.course!.spine;
    const steer = decideSteer({
      mode: ctx.mode,
      pacing: ctx.pacing,
      spine,
      policy,
      now: Date.now(),
      learnerReady: ctx.intent === 'start' || ctx.intent === 'continue',
      justCompleted: ctx.justCompleted,
      itemOpen: Boolean(ctx.openItem) && ctx.openItem!.state !== 'completed',
    });
    const atmosphere = atmosphereOf({
      mode: ctx.mode,
      releaseWindowOpen: releaseWindowOpen(
        ctx.pacing,
        policy.releaseWindowMaxTurns,
      ),
      spine,
    });
    ctx.steer = steer;
    ctx.atmosphere = atmosphere;
    ctx.situationInput = {
      ...ctx.situationInput!,
      mode: ctx.mode,
      overlay: ctx.overlay,
      steer,
      atmosphere,
    };
    ctx.situation = renderSituationReport(ctx.situationInput);
  }

  private async respondWithCrisis(
    ctx: GuideTurnContext,
    source: string,
  ): Promise<void> {
    const language = ctx.course?.languageCode ?? 'en';
    const copy = await this.crisis.responseText(ctx.tenantId, language);
    const lines = this.crisis.lines(ctx.orgProfile, language);
    // Already in crisis: stay with the learner rather than repeat the whole
    // response (plan §6.3 step 5); the lines are shown again either way.
    if (ctx.thread?.mode === GuideMode.CRISIS) {
      copy.text = DEFAULT_CRISIS_STAY_TEXT;
    }
    ctx.crisis = { ...copy, lines };
    // Voice stays open and the fixed message is spoken (plan §6.3 step 4).
    ctx.voice?.onDelta(copy.text, 'crisis');
    ctx.mode = GuideMode.CRISIS;
    ctx.replyKind = 'crisis';
    ctx.replyText = copy.text;
    // The model's history records the learner's words and the fixed reply —
    // no situation report, because no model ran for this turn.
    ctx.learnerRendered = [ctx.learnerMessage!];
    ctx.replyBlocks = [
      { role: 'assistant', content: [{ type: 'text', text: copy.text }] },
    ];
    await this.crisis
      .record({
        threadId: ctx.threadId,
        userId: ctx.userId,
        tenantId: ctx.tenantId,
        releaseId: ctx.releaseId,
        language: copy.language,
        source,
      })
      .catch((error) => this.logger.error('Crisis record write failed', error));
  }

  private async respondWithFixed(
    ctx: GuideTurnContext,
    kind: ReplyKind,
    text: string,
    learnerRendered: AgentMessage[],
  ): Promise<void> {
    ctx.replyKind = kind;
    ctx.replyText = text;
    ctx.learnerRendered = learnerRendered;
    ctx.replyBlocks = [
      { role: 'assistant', content: [{ type: 'text', text }] },
    ];
    for (const chunk of chunkForStreaming(text)) {
      ctx.voice?.onDelta(chunk);
      if (ctx.ttftMs === null) {
        ctx.ttftMs = Date.now() - ctx.startedAt;
        await this.presence(ctx, 'speaking', null);
      }
      await this.bus.emitEphemeral(
        ctx.threadId,
        'assistant.delta',
        { turnId: ctx.turnId, messageId: ctx.replyMessageId, text: chunk },
        ctx.lastSeq,
      );
    }
  }

  /** The item a message most likely concerns, for the Sentinel's context. */
  private sentinelItem(spine: CourseSpine) {
    const recentlyCompleted = [...spine.items]
      .filter((item) => item.completedAt)
      .sort(
        (a, b) => Date.parse(b.completedAt!) - Date.parse(a.completedAt!),
      )[0];
    const item: SpineItem | null =
      recentlyCompleted &&
      Date.now() - Date.parse(recentlyCompleted.completedAt!) < 30 * 60_000
        ? recentlyCompleted
        : spine.current;
    return item
      ? {
          title: item.title,
          type: item.type,
          triggerWarnings: item.triggerWarnings,
        }
      : null;
  }

  private toolContext(ctx: GuideTurnContext): GuideToolContext {
    const tool: GuideToolContext = {
      threadId: ctx.threadId,
      turnId: ctx.turnId,
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      courseTitle: ctx.course!.title,
      courseDescription: ctx.course!.description,
      language: ctx.course!.languageCode,
      mode: ctx.mode,
      spine: ctx.course!.spine,
      steer: ctx.steer!,
      orgProfile: ctx.orgProfile,
      pacing: ctx.pacing,
      presented: ctx.presented,
      trackId: ctx.thread!.trackId,
      bundle: ctx.bundle!,
      tier: ctx.tier,
      attribution: {
        threadId: ctx.threadId,
        turnId: ctx.turnId,
        userId: ctx.userId,
        tenantId: ctx.tenantId,
        releaseId: ctx.releaseId,
      },
      onCost: (usd) => {
        ctx.usd += usd;
      },
      overlay: ctx.overlay,
      memoryEnabled: ctx.memoryEnabled,
      learnerTexts: [
        ...ctx.recentTurns
          .filter((turn) => turn.role === 'learner')
          .map((turn) => turn.text),
        ctx.text,
      ].filter(Boolean),
      epochNumber: ctx.epoch?.number ?? 0,
      epochStartedAt: ctx.epoch?.snapshot?.startedAt ?? null,
      platformTurn: Boolean(ctx.platformEvent) && !ctx.text.trim(),
      learnerMessageId: ctx.learnerMessageId,
      emitDurable: async (type, data) => {
        if (type === 'card.presented' && ctx.voice) {
          ctx.voice.onCardHint(cardHint((data as any).card));
        }
        const event = await this.bus.appendDurable(
          ctx.threadId,
          type as never,
          data as never,
          ctx.turnId,
        );
        ctx.lastSeq = event.seq;
        return event.seq;
      },
    };
    // Tools change pacing through their context; carry it back to the turn.
    return new Proxy(tool, {
      set: (target, key, value) => {
        (target as any)[key] = value;
        if (key === 'pacing') ctx.pacing = value;
        return true;
      },
    });
  }

  private async toolActivity(ctx: GuideTurnContext, name: string) {
    const label = TOOL_ACTIVITY[name];
    if (!label) return;
    await this.bus
      .emitEphemeral(
        ctx.threadId,
        'tool.activity',
        { turnId: ctx.turnId, label },
        ctx.lastSeq,
      )
      .catch(() => undefined);
  }

  private async presence(
    ctx: GuideTurnContext,
    state: 'idle' | 'thinking' | 'speaking',
    caption: string | null,
  ): Promise<void> {
    await this.bus
      .emitEphemeral(ctx.threadId, 'presence', { state, caption }, ctx.lastSeq)
      .catch(() => undefined);
  }

  // ── persist.reply ──────────────────────────────────────────────────────

  private async persistReply(ctx: GuideTurnContext): Promise<void> {
    const thread = ctx.thread!;
    const flags = this.flagsFor(ctx);

    // Text the learner already saw before a late crisis cut the reply short.
    if (ctx.replyKind === 'crisis' && ctx.interruptedText?.trim()) {
      await this.threads.appendMessage(ctx.threadId, ctx.tenantId, {
        role: GuideMessageRole.ALLY,
        content: ctx.interruptedText.trim(),
        turnId: null,
        metadata: { interrupted: true, turnId: ctx.turnId },
      });
    }

    const reply = await this.threads.appendMessage(ctx.threadId, ctx.tenantId, {
      id: ctx.replyMessageId,
      role: GuideMessageRole.ALLY,
      channel: ctx.channel === 'voice' ? AgentChannel.VOICE : AgentChannel.TEXT,
      kind:
        ctx.replyKind === 'crisis'
          ? GuideMessageKind.CRISIS_FIXED
          : ctx.replyKind === 'model' || ctx.replyKind === 'interrupted'
            ? GuideMessageKind.CHAT
            : GuideMessageKind.FIXED,
      content: ctx.replyText ?? null,
      turnId: ctx.turnId,
      providerBlocks: ctx.replyBlocks as Record<string, any>[],
      toolCalls: ctx.output?.toolCalls.map((call) => ({
        name: call.name,
        input: call.input,
        isError: call.isError,
      })),
      metadata: {
        replyKind: ctx.replyKind,
        ...(ctx.replyKind === 'interrupted' ? { interrupted: true } : {}),
        model:
          ctx.replyKind === 'model' || ctx.replyKind === 'interrupted'
            ? ctx.model
            : null,
        tier: ctx.tier,
        releaseId: ctx.releaseId,
        stopReason: ctx.output?.stopReason ?? null,
        passes: ctx.output?.passes ?? 0,
        restarted: ctx.restarted,
      },
    });
    await this.threads.setRenderedContent(
      ctx.learnerMessageId!,
      ctx.learnerRendered as Record<string, any>[],
      flags,
    );
    if (ctx.pendingTriggers.length) {
      await this.triggers.update(
        ctx.pendingTriggers.map((trigger) => trigger.id),
        { status: GuideTriggerStatus.CONSUMED, consumedByTurnId: ctx.turnId },
      );
    }

    if (ctx.replyKind === 'crisis') {
      const event = await this.bus.appendDurable(
        ctx.threadId,
        'crisis.response',
        {
          messageId: reply.id,
          text: ctx.replyText!,
          language: ctx.crisis!.language,
          lines: ctx.crisis!.lines.map((line) => ({
            name: line.name,
            phone: line.phone,
            hours: line.hours ?? null,
            url: line.url ?? null,
          })),
        },
        ctx.turnId,
      );
      ctx.lastSeq = event.seq;
    } else {
      const event = await this.bus.appendDurable(
        ctx.threadId,
        'assistant.message',
        {
          messageId: reply.id,
          turnId: ctx.turnId,
          text: ctx.replyText ?? '',
          channel: ctx.channel,
        },
        ctx.turnId,
      );
      ctx.lastSeq = event.seq;
    }

    const modeChanged = ctx.mode !== thread.mode;
    if (modeChanged) {
      const atmosphere = atmosphereOf({
        mode: ctx.mode,
        releaseWindowOpen: releaseWindowOpen(
          ctx.pacing,
          ctx.bundle!.policy.releaseWindowMaxTurns,
        ),
        spine: ctx.course!.spine,
      });
      const event = await this.bus.appendDurable(
        ctx.threadId,
        'mode.changed',
        { mode: ctx.mode, atmosphere },
        ctx.turnId,
      );
      ctx.lastSeq = event.seq;
    }

    await this.threads.saveState(ctx.threadId, {
      pacing: ctx.pacing,
      ...(modeChanged ? { mode: ctx.mode, modeChangedAt: new Date() } : {}),
      ...(ctx.epoch?.isNew
        ? {
            epoch: ctx.epoch.number,
            epochSnapshot: ctx.epoch.snapshot,
            releaseId: ctx.releaseId,
          }
        : {}),
    });

    const spine = ctx.course!.spine;
    const hidden =
      !ctx.steer?.dockVisible ||
      ctx.mode === GuideMode.CRISIS ||
      ctx.mode === GuideMode.CARE;
    await this.bus.emitEphemeral(
      ctx.threadId,
      'next_step',
      {
        hidden,
        itemId: spine.current?.id ?? null,
        title: spine.current?.title ?? null,
        minutes: spine.current?.estimatedMinutes ?? null,
      },
      ctx.lastSeq,
    );
  }

  private flagsFor(ctx: GuideTurnContext) {
    const verdict = ctx.verdict;
    if (!verdict) return undefined;
    const flags = {
      crisis: ctx.replyKind === 'crisis' || undefined,
      care: isLearnerDistress(verdict) || undefined,
      realCase:
        verdict.overlay === 'real_case' ||
        verdict.overlay === 'real_case_urgent' ||
        undefined,
      pii: verdict.overlay === 'pii' || undefined,
    };
    return Object.values(flags).some(Boolean) ? (flags as never) : undefined;
  }

  // ── finish ─────────────────────────────────────────────────────────────

  private async finish(ctx: GuideTurnContext): Promise<void> {
    const durationMs = Date.now() - ctx.startedAt;
    const failed = Boolean(ctx.failure);
    await this.presence(ctx, 'idle', null);
    await this.turnStore
      .finish(ctx.turnId, {
        status: failed ? AgentTurnStatus.FAILED : AgentTurnStatus.COMPLETED,
        errorCode: ctx.failure?.code ?? null,
        ttftMs: ctx.ttftMs,
        durationMs,
        costUsd: ctx.usd,
      })
      .catch((error) =>
        this.logger.warn(`Turn finish write failed: ${String(error)}`),
      );
    // Unlock before announcing the end: a learner who presses Continue the
    // moment a reply finishes must not be told Ally is still replying.
    if (ctx.locked) {
      await this.redis.releaseLock(ctx.lockKey);
      ctx.locked = false;
    }
    // A platform turn the learner never saw start ends silently: an error
    // for a turn they did not ask for would only alarm them.
    const silent = Boolean(ctx.platformEvent) && !ctx.announced;
    await (silent
      ? Promise.resolve()
      : this.bus
          .emitEphemeral(
            ctx.threadId,
            failed ? 'turn.failed' : 'turn.completed',
            failed
              ? {
                  turnId: ctx.turnId,
                  code: (ctx.failure?.code ?? 'internal_error') as never,
                  message: ctx.failure?.message ?? '',
                }
              : { turnId: ctx.turnId },
            ctx.lastSeq,
          )
          .catch(() => undefined));
    const usage = ctx.output?.usage ?? [];
    const sum = (
      key:
        | 'inputTokens'
        | 'outputTokens'
        | 'cachedTokens'
        | 'cacheCreationTokens',
    ) => usage.reduce((total, line) => total + (line?.[key] ?? 0), 0);
    await this.traces.write({
      turnId: ctx.turnId,
      agentKey: ctx.agentKey,
      threadId: ctx.threadId,
      releaseId: ctx.releaseId,
      tenantId: ctx.tenantId,
      summary: {
        outcome: failed ? 'failed' : 'completed',
        failure: ctx.failure ?? null,
        stages: ctx.timings,
        ttftMs: ctx.ttftMs,
        durationMs,
        replyKind: ctx.replyKind ?? null,
        replyMessageId: ctx.replyKind ? ctx.replyMessageId : null,
        epoch: ctx.epoch
          ? {
              number: ctx.epoch.number,
              isNew: ctx.epoch.isNew,
              reason: ctx.epoch.snapshot.reason ?? null,
              historyMessages: ctx.history.length,
            }
          : null,
        model: ctx.model ?? null,
        tier: ctx.tier ?? null,
        modeBefore: ctx.thread?.mode ?? null,
        modeAfter: ctx.mode,
        restarted: ctx.restarted,
        steer: ctx.steer
          ? { level: ctx.steer.level, reason: ctx.steer.reason }
          : null,
        sentinel: ctx.verdict
          ? {
              risk: ctx.verdict.risk,
              about: ctx.verdict.about,
              overlay: ctx.verdict.overlay,
              confidence: ctx.verdict.confidence,
              source: ctx.verdict.source,
              latencyMs: ctx.verdict.latencyMs,
            }
          : null,
        tools: (ctx.output?.toolCalls ?? []).map((call) => ({
          name: call.name,
          isError: call.isError,
        })),
        cards: ctx.presented.map((card) => ({
          kind: card.kind,
          title: card.title,
        })),
        passes: ctx.output?.passes ?? 0,
        usage: {
          input: sum('inputTokens'),
          output: sum('outputTokens'),
          cacheRead: sum('cachedTokens'),
          cacheWrite: sum('cacheCreationTokens'),
        },
        costUsd: Number(ctx.usd.toFixed(6)),
        spanHashes: ctx.system?.hashes ?? null,
      },
      // The full picture — learner text included — goes to the payload,
      // which has retention and deletion; the summary row stays content-free.
      payload: ctx.situation
        ? {
            situationReport: ctx.situation,
            sentinelEvidence: ctx.verdict?.evidence ?? null,
            toolCalls: ctx.output?.toolCalls ?? [],
            reply: ctx.replyText ?? null,
          }
        : undefined,
    });
  }
}

/** Split a reply into word-boundary chunks so the client streams it. */
export function chunkForStreaming(text: string, size = 24): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const word of text.split(/(\s+)/)) {
    if ((current + word).length > size && current) {
      chunks.push(current);
      current = '';
    }
    current += word;
  }
  if (current) chunks.push(current);
  return chunks;
}

/** A speakable line for a card appearing on screen during a voice turn. */
export function cardHint(
  card: { kind?: string; presentation?: string; title?: string } | undefined,
): string {
  if (!card) return '';
  switch (card.presentation) {
    case 'shelf':
      return `I've opened ${card.title ? `"${card.title}"` : 'it'} on your right.`;
    case 'theatre':
      return `${card.title ? `"${card.title}"` : 'It'} is ready whenever you are.`;
    default:
      return "It's just below.";
  }
}
