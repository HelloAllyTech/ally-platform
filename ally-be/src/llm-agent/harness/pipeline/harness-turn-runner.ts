/**
 * The harness turn pipeline (plans/ally-guide/plan.md §7.3).
 *
 * A turn is an ordered list of named stages — receive, admit, guard.input,
 * plan, assemble, model, guard.output, persist, emit — each a small object
 * with one `run`. New behaviour arrives as another stage or a hook, never as
 * an edit to a monolithic loop. Every stage is timed; the timings become the
 * waterfall in the admin Turn Inspector.
 *
 * Control flow:
 *  - a stage returns 'stop' to end the turn early on purpose (a fixed crisis
 *    response, a refused admission) — outcome 'stopped';
 *  - a stage throws to fail the turn — outcome 'failed' with a code
 *    (HarnessStageError carries one; anything else is 'internal_error');
 *  - stages marked `always` (persist the trace, release the lock) run even
 *    after a stop or a failure, so cleanup cannot be skipped.
 *
 * Hooks observe; they never change the outcome. A hook that throws is logged
 * through `onHookError` and ignored, because telemetry must not break a turn.
 *
 * The turn is an OpenTelemetry `invoke_agent <agentKey>` span (GenAI
 * conventions) with one child span per stage, continuing the request's trace
 * when `traceCarrier` holds its `traceparent`. Spans carry ids and outcomes
 * only — see src/observability/tracing.ts.
 */
import { SpanStatusCode } from '@opentelemetry/api';
import {
  AGENT_ATTR,
  GEN_AI,
  TraceCarrier,
  parentContext,
  setSpanAttributes,
  withSpan,
} from 'src/observability/tracing';

export type HarnessStageOutcome = 'ok' | 'stopped' | 'error' | 'skipped';

export interface HarnessStageTiming {
  stage: string;
  startedAt: number;
  ms: number;
  outcome: HarnessStageOutcome;
}

export interface HarnessTurnFailure {
  stage: string;
  code: string;
  message: string;
}

export interface HarnessTurnContext {
  turnId: string;
  agentKey: string;
  timings: HarnessStageTiming[];
  failure?: HarnessTurnFailure;
  stoppedAt?: string;
  /** The thread or session, as `gen_ai.conversation.id`. */
  conversationId?: string;
  /** The originating request's W3C trace context, if it sent one. */
  traceCarrier?: TraceCarrier | null;
}

export type HarnessStageResult = void | 'stop';

export interface HarnessStage<C extends HarnessTurnContext> {
  readonly name: string;
  /** Runs even after an earlier stage stopped or failed the turn. */
  readonly always?: boolean;
  run(ctx: C): Promise<HarnessStageResult> | HarnessStageResult;
}

export interface HarnessHooks<C extends HarnessTurnContext> {
  before?(stage: string, ctx: C): void | Promise<void>;
  after?(
    stage: string,
    ctx: C,
    timing: HarnessStageTiming,
  ): void | Promise<void>;
  onError?(stage: string, ctx: C, error: unknown): void | Promise<void>;
}

/** A stage failure with a code the client can map to a designed state. */
export class HarnessStageError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HarnessStageError';
  }
}

export type HarnessTurnOutcome = 'completed' | 'stopped' | 'failed';

export interface HarnessRunOptions {
  /** Called when a hook throws. Defaults to swallowing silently. */
  onHookError?: (hook: string, stage: string, error: unknown) => void;
  now?: () => number;
}

export async function runHarnessStages<C extends HarnessTurnContext>(
  ctx: C,
  stages: ReadonlyArray<HarnessStage<C>>,
  hooks: ReadonlyArray<HarnessHooks<C>> = [],
  options: HarnessRunOptions = {},
): Promise<HarnessTurnOutcome> {
  return withSpan(
    `invoke_agent ${ctx.agentKey}`,
    {
      [GEN_AI.OPERATION_NAME]: 'invoke_agent',
      [GEN_AI.AGENT_NAME]: ctx.agentKey,
      [GEN_AI.CONVERSATION_ID]: ctx.conversationId,
      [AGENT_ATTR.TURN_ID]: ctx.turnId,
    },
    async (turnSpan) => {
      const outcome = await runStages(ctx, stages, hooks, options);
      setSpanAttributes(turnSpan, {
        [AGENT_ATTR.OUTCOME]: outcome,
        [AGENT_ATTR.ERROR_TYPE]: ctx.failure?.code,
      });
      if (outcome === 'failed') {
        turnSpan.setStatus({ code: SpanStatusCode.ERROR });
      }
      return outcome;
    },
    parentContext(ctx.traceCarrier),
  );
}

async function runStages<C extends HarnessTurnContext>(
  ctx: C,
  stages: ReadonlyArray<HarnessStage<C>>,
  hooks: ReadonlyArray<HarnessHooks<C>>,
  options: HarnessRunOptions,
): Promise<HarnessTurnOutcome> {
  const now = options.now ?? Date.now;
  const callHooks = async (
    name: 'before' | 'after' | 'onError',
    stage: string,
    ...args: unknown[]
  ): Promise<void> => {
    for (const hook of hooks) {
      const fn = hook[name] as
        | ((stage: string, ctx: C, ...rest: unknown[]) => unknown)
        | undefined;
      if (!fn) continue;
      try {
        await fn.call(hook, stage, ctx, ...args);
      } catch (error) {
        options.onHookError?.(name, stage, error);
      }
    }
  };

  let outcome: HarnessTurnOutcome = 'completed';

  for (const stage of stages) {
    if (outcome !== 'completed' && !stage.always) {
      ctx.timings.push({
        stage: stage.name,
        startedAt: now(),
        ms: 0,
        outcome: 'skipped',
      });
      continue;
    }

    const startedAt = now();
    await callHooks('before', stage.name);
    let stageOutcome: HarnessStageOutcome = 'ok';
    try {
      const result = await withSpan(
        `agent.stage ${stage.name}`,
        {
          [AGENT_ATTR.STAGE]: stage.name,
          [AGENT_ATTR.TURN_ID]: ctx.turnId,
          [GEN_AI.AGENT_NAME]: ctx.agentKey,
        },
        async () => stage.run(ctx),
      );
      if (result === 'stop' && outcome === 'completed') {
        stageOutcome = 'stopped';
        outcome = 'stopped';
        ctx.stoppedAt = stage.name;
      }
    } catch (error) {
      stageOutcome = 'error';
      // A cleanup stage failing after the turn already ended keeps the
      // original outcome; it is still recorded in the timings.
      if (outcome === 'completed') {
        outcome = 'failed';
        ctx.failure = {
          stage: stage.name,
          code:
            error instanceof HarnessStageError ? error.code : 'internal_error',
          message: error instanceof Error ? error.message : String(error),
        };
      }
      await callHooks('onError', stage.name, error);
    }
    const timing: HarnessStageTiming = {
      stage: stage.name,
      startedAt,
      ms: now() - startedAt,
      outcome: stageOutcome,
    };
    ctx.timings.push(timing);
    await callHooks('after', stage.name, timing);
  }

  return outcome;
}
