import { BadRequestException, Injectable } from '@nestjs/common';
import { TokenUser } from 'src/auth/type/auth.types';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';
import {
  AgentChannel,
  AgentTurnStatus,
  AgentTurnTrigger,
} from 'src/llm-agent/harness/enum/harness.enum';
import {
  HarnessStage,
  HarnessStageError,
  HarnessTurnContext,
  runHarnessStages,
} from 'src/llm-agent/harness/pipeline/harness-turn-runner';
import { AgentReleaseService } from 'src/llm-agent/harness/release/agent-release.service';
import { AgentTraceService } from 'src/llm-agent/harness/trace/agent-trace.service';
import { AgentTurnStoreService } from 'src/llm-agent/harness/turn/agent-turn-store.service';
import { TraceCarrier } from 'src/observability/tracing';
import { GuideThread } from '../entity/guide-thread.entity';
import { GuideMessageKind, GuideMessageRole } from '../enum/guide.enum';
import {
  ALLY_GUIDE_AGENT_KEY,
  GUIDE_DEFAULT_POLICY,
  GuideReleaseBundle,
} from '../release/guide-release.bundle';
import { GuideSettingsService } from '../settings/guide-settings.service';
import { guideMessageTooLong } from '../guide-errors';
import { GuideEventBusService } from './guide-event-bus.service';
import { GuideThreadService } from './guide-thread.service';

/** One turn at a time per thread; the lock outlives the hard timeout. */
export const GUIDE_TURN_LOCK_PREFIX = 'guide-turn';
export const GUIDE_TURN_LOCK_TTL_SECONDS = 120;

/**
 * The step-1.0 reply: pre-written, never model text. It proves the whole
 * path — admission, transcript, outbox, fan-out, traces — end to end before
 * the orchestrator exists. Step 1.1 replaces the `reply` stage with the
 * Conductor, Sentinel and orchestrator; nothing else in this file changes.
 */
export const GUIDE_STUB_REPLY =
  "Hi, I'm Ally. I'm still being set up for this course, so I can't walk it " +
  "with you just yet — but this is where we'll talk. For now you can keep " +
  'going in the classic view; your progress carries over.';

export interface GuideTurnContext extends HarnessTurnContext {
  threadId: string;
  userId: number;
  tenantId: string;
  text: string;
  clientTurnId: string;
  startedAt: number;
  lastSeq: number;
  releaseId: string | null;
  bundle: GuideReleaseBundle | null;
  ttftMs: number | null;
  lockKey: string;
  locked: boolean;
  replyMessageId?: string;
}

/**
 * Accepts a learner turn (`202 {turnId}`) and runs it through the harness
 * pipeline in the background; everything the learner sees arrives on the
 * thread's event stream (plans/ally-guide/plan.md §7.8, §9.1).
 */
@Injectable()
export class GuideTurnService {
  private readonly logger = LoggerService.getInstance(GuideTurnService.name);

  constructor(
    private readonly threads: GuideThreadService,
    private readonly bus: GuideEventBusService,
    private readonly turnStore: AgentTurnStoreService,
    private readonly releases: AgentReleaseService,
    private readonly traces: AgentTraceService,
    private readonly settings: GuideSettingsService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Record the turn (idempotent on `clientTurnId`) and start it. A resent
   * request returns the same turn id and does not run it again.
   */
  async accept(
    thread: GuideThread,
    user: TokenUser,
    input: { clientTurnId: string; text: string; intent?: string | null },
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
      trigger: AgentTurnTrigger.LEARNER_MESSAGE,
      channel: AgentChannel.TEXT,
      tenantId: thread.tenantId ?? null,
    });
    if (created) {
      const ctx: GuideTurnContext = {
        turnId: turn.id,
        agentKey: ALLY_GUIDE_AGENT_KEY,
        timings: [],
        conversationId: thread.id,
        traceCarrier: traceCarrier ?? null,
        threadId: thread.id,
        userId: user.id,
        tenantId: user.tenantId,
        text,
        clientTurnId: input.clientTurnId,
        startedAt: Date.now(),
        lastSeq: thread.lastEventSeq,
        releaseId: null,
        bundle: null,
        ttftMs: null,
        lockKey: `${GUIDE_TURN_LOCK_PREFIX}:${thread.id}`,
        locked: false,
      };
      setImmediate(() => {
        this.run(ctx).catch((error) =>
          this.logger.error(`Guide turn ${turn.id} crashed`, error),
        );
      });
    }
    return { turnId: turn.id };
  }

  /** The pipeline. Exposed for tests; production calls it via `accept`. */
  async run(ctx: GuideTurnContext): Promise<void> {
    const outcome = await runHarnessStages(ctx, this.stages(), [], {
      onHookError: () => undefined,
    });
    this.logger.info(
      `Guide turn ${ctx.turnId} on thread ${ctx.threadId}: ${outcome}` +
        (ctx.failure ? ` (${ctx.failure.code} at ${ctx.failure.stage})` : ''),
    );
  }

  private stages(): HarnessStage<GuideTurnContext>[] {
    return [
      {
        name: 'admit',
        run: async (ctx) => {
          if (
            !(await this.redis.acquireLock(
              ctx.lockKey,
              GUIDE_TURN_LOCK_TTL_SECONDS,
            ))
          ) {
            throw new HarnessStageError(
              'turn_in_progress',
              'Ally is replying in another tab.',
            );
          }
          ctx.locked = true;
          const thread = await this.threads.getOwned(ctx.threadId, {
            id: ctx.userId,
            tenantId: ctx.tenantId,
            username: '',
          });
          if (
            !(await this.settings.isGuidedAvailable(
              thread.trackId,
              ctx.tenantId,
            ))
          ) {
            throw new HarnessStageError(
              'guide_disabled',
              'The guide is switched off.',
            );
          }
          const release = await this.releases.getGa(ALLY_GUIDE_AGENT_KEY);
          ctx.releaseId = release?.id ?? null;
          ctx.bundle = (release?.bundle as GuideReleaseBundle) ?? null;
          await this.turnStore.transition(
            ctx.turnId,
            AgentTurnStatus.ADMITTED,
            {
              startedAt: new Date(ctx.startedAt),
              releaseId: ctx.releaseId,
            },
          );
        },
      },
      {
        name: 'persist.learner',
        run: async (ctx) => {
          const message = await this.threads.appendMessage(
            ctx.threadId,
            ctx.tenantId,
            {
              role: GuideMessageRole.LEARNER,
              content: ctx.text,
              turnId: ctx.turnId,
              clientTurnId: ctx.clientTurnId,
            },
          );
          await this.threads.touchLearnerActivity(ctx.threadId);
          const event = await this.bus.appendDurable(
            ctx.threadId,
            'learner.message',
            {
              messageId: message.id,
              turnId: ctx.turnId,
              clientTurnId: ctx.clientTurnId,
              text: ctx.text,
              channel: 'text',
            },
            ctx.turnId,
          );
          ctx.lastSeq = event.seq;
          await this.bus.emitEphemeral(
            ctx.threadId,
            'turn.started',
            { turnId: ctx.turnId, trigger: 'learner_message' },
            ctx.lastSeq,
          );
        },
      },
      {
        name: 'reply',
        run: async (ctx) => {
          await this.turnStore.transition(
            ctx.turnId,
            AgentTurnStatus.STREAMING,
          );
          await this.bus.emitEphemeral(
            ctx.threadId,
            'presence',
            { state: 'speaking', caption: null },
            ctx.lastSeq,
          );
          const reply = await this.threads.appendMessage(
            ctx.threadId,
            ctx.tenantId,
            {
              role: GuideMessageRole.ALLY,
              kind: GuideMessageKind.FIXED,
              content: GUIDE_STUB_REPLY,
              turnId: ctx.turnId,
              metadata: { stub: 'step-1.0' },
            },
          );
          ctx.replyMessageId = reply.id;
          for (const chunk of chunkForStreaming(GUIDE_STUB_REPLY)) {
            if (ctx.ttftMs === null) ctx.ttftMs = Date.now() - ctx.startedAt;
            await this.bus.emitEphemeral(
              ctx.threadId,
              'assistant.delta',
              { turnId: ctx.turnId, messageId: reply.id, text: chunk },
              ctx.lastSeq,
            );
          }
          const event = await this.bus.appendDurable(
            ctx.threadId,
            'assistant.message',
            {
              messageId: reply.id,
              turnId: ctx.turnId,
              text: GUIDE_STUB_REPLY,
              channel: 'text',
            },
            ctx.turnId,
          );
          ctx.lastSeq = event.seq;
        },
      },
      {
        name: 'finish',
        always: true,
        run: async (ctx) => {
          const durationMs = Date.now() - ctx.startedAt;
          const failed = Boolean(ctx.failure);
          await this.bus
            .emitEphemeral(
              ctx.threadId,
              'presence',
              { state: 'idle', caption: null },
              ctx.lastSeq,
            )
            .catch(() => undefined);
          await this.bus
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
            .catch(() => undefined);
          await this.turnStore
            .finish(ctx.turnId, {
              status: failed
                ? AgentTurnStatus.FAILED
                : AgentTurnStatus.COMPLETED,
              errorCode: ctx.failure?.code ?? null,
              ttftMs: ctx.ttftMs,
              durationMs,
            })
            .catch((error) =>
              this.logger.warn(`Turn finish write failed: ${String(error)}`),
            );
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
              replyKind: 'stub',
              replyMessageId: ctx.replyMessageId ?? null,
            },
          });
          if (ctx.locked) {
            await this.redis.releaseLock(ctx.lockKey);
            ctx.locked = false;
          }
        },
      },
    ];
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
