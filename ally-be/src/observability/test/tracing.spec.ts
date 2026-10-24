import { AsyncLocalStorage } from 'node:async_hooks';
import {
  Context,
  ContextManager,
  ROOT_CONTEXT,
  Span,
  SpanContext,
  SpanOptions,
  SpanStatus,
  SpanStatusCode,
  TextMapPropagator,
  Tracer,
  context,
  propagation,
  trace,
} from '@opentelemetry/api';
import {
  HarnessStage,
  HarnessStageError,
  HarnessTurnContext,
  runHarnessStages,
} from 'src/llm-agent/harness/pipeline/harness-turn-runner';
import {
  AGENT_ATTR,
  GEN_AI,
  errorType,
  spanAttributes,
  withSpan,
} from '../tracing';

// ── A minimal in-memory OpenTelemetry SDK stand-in (no SDK is installed) ──

let nextId = 1;
const hex = (n: number, width: number) => n.toString(16).padStart(width, '0');

class RecordingSpan {
  attributes: Record<string, unknown> = {};
  status: SpanStatus = { code: SpanStatusCode.UNSET };
  ended = false;
  readonly ctx: SpanContext;
  constructor(
    readonly name: string,
    readonly parent: SpanContext | undefined,
    options: SpanOptions,
  ) {
    Object.assign(this.attributes, options.attributes ?? {});
    this.ctx = {
      traceId: parent?.traceId ?? hex(nextId, 32),
      spanId: hex(nextId++, 16),
      traceFlags: 1,
    };
  }
  spanContext() {
    return this.ctx;
  }
  setAttribute(key: string, value: unknown) {
    this.attributes[key] = value;
    return this;
  }
  setAttributes(attributes: Record<string, unknown>) {
    Object.assign(this.attributes, attributes);
    return this;
  }
  setStatus(status: SpanStatus) {
    this.status = status;
    return this;
  }
  end() {
    this.ended = true;
  }
  isRecording() {
    return true;
  }
  addEvent() {
    return this;
  }
  addLink() {
    return this;
  }
  addLinks() {
    return this;
  }
  updateName() {
    return this;
  }
  recordException() {}
}

const spans: RecordingSpan[] = [];

function startSpan(name: string, options: SpanOptions = {}, ctx?: Context) {
  const span = new RecordingSpan(
    name,
    trace.getSpanContext(ctx ?? context.active()),
    options,
  );
  spans.push(span);
  return span as unknown as Span;
}

const tracer = {
  startSpan,
  startActiveSpan(name: string, ...args: unknown[]) {
    const fn = args[args.length - 1] as (span: Span) => unknown;
    const options = (args.length >= 2 ? args[0] : {}) as SpanOptions;
    const ctx = (args.length >= 3 ? args[1] : context.active()) as Context;
    const span = startSpan(name, options, ctx);
    return context.with(trace.setSpan(ctx, span), () => fn(span));
  },
} as unknown as Tracer;

class AlsContextManager implements ContextManager {
  private readonly als = new AsyncLocalStorage<Context>();
  active() {
    return this.als.getStore() ?? ROOT_CONTEXT;
  }
  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    ctx: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    return this.als.run(ctx, () => fn.apply(thisArg, args));
  }
  bind<T>(_ctx: Context, target: T): T {
    return target;
  }
  enable() {
    return this;
  }
  disable() {
    this.als.disable();
    return this;
  }
}

/** Reads `traceparent` (version-traceid-spanid-flags) into a remote parent. */
const w3cLike: TextMapPropagator = {
  inject() {},
  extract(ctx, carrier, getter) {
    const header = getter.get(carrier, 'traceparent');
    const value = Array.isArray(header) ? header[0] : header;
    const [, traceId, spanId] = (value ?? '').split('-');
    if (!traceId || !spanId) return ctx;
    return trace.setSpanContext(ctx, {
      traceId,
      spanId,
      traceFlags: 1,
      isRemote: true,
    });
  },
  fields: () => ['traceparent', 'tracestate'],
};

// ── Tests ──

describe('spanAttributes', () => {
  it('keeps allowlisted ids and drops unknown keys, prose, nulls and NaN', () => {
    expect(
      spanAttributes({
        [GEN_AI.AGENT_NAME]: 'ally_guide',
        [AGENT_ATTR.TURN_ID]: '6a9f1fea-2733-4cd9-87fd-e5f42ba06d23',
        [GEN_AI.REQUEST_MODEL]: 'claude-opus-5-5',
        [GEN_AI.USAGE_INPUT_TOKENS]: 1200,
        [AGENT_ATTR.STAGE]: 'I want to talk about something hard',
        [AGENT_ATTR.RELEASE_ID]: null,
        [GEN_AI.USAGE_OUTPUT_TOKENS]: Number.NaN,
        'learner.text': 'hello',
      }),
    ).toEqual({
      [GEN_AI.AGENT_NAME]: 'ally_guide',
      [AGENT_ATTR.TURN_ID]: '6a9f1fea-2733-4cd9-87fd-e5f42ba06d23',
      [GEN_AI.REQUEST_MODEL]: 'claude-opus-5-5',
      [GEN_AI.USAGE_INPUT_TOKENS]: 1200,
    });
  });
});

describe('errorType', () => {
  it('names the failure by code or class, never by message', () => {
    expect(errorType(new HarnessStageError('guide_disabled', 'off'))).toBe(
      'guide_disabled',
    );
    expect(errorType(new TypeError('learner said something'))).toBe(
      'TypeError',
    );
    expect(errorType('a string with the learner text')).toBe('unknown');
  });
});

describe('withSpan without an SDK', () => {
  it('runs the work and returns its value (no-op tracer)', async () => {
    await expect(withSpan('noop', {}, async () => 42)).resolves.toBe(42);
  });
});

describe('harness turn spans', () => {
  beforeAll(() => {
    context.setGlobalContextManager(new AlsContextManager());
    trace.setGlobalTracerProvider({ getTracer: () => tracer });
    propagation.setGlobalPropagator(w3cLike);
  });
  afterAll(() => {
    trace.disable();
    context.disable();
    propagation.disable();
  });
  beforeEach(() => {
    spans.length = 0;
  });

  type Ctx = HarnessTurnContext & { text: string };
  const LEARNER_TEXT = 'I keep thinking about my client tonight';
  const makeCtx = (extra: Partial<Ctx> = {}): Ctx => ({
    turnId: 'turn-1',
    agentKey: 'ally_guide',
    conversationId: 'thread-1',
    timings: [],
    text: LEARNER_TEXT,
    ...extra,
  });
  const stage = (
    name: string,
    run: HarnessStage<Ctx>['run'] = () => undefined,
    always = false,
  ): HarnessStage<Ctx> => ({ name, run, always });

  it('records one invoke_agent span with a child per stage that ran', async () => {
    const outcome = await runHarnessStages(makeCtx(), [
      stage('admit'),
      stage('reply', () => 'stop'),
      stage('model'),
      stage('finish', () => undefined, true),
    ]);
    expect(outcome).toBe('stopped');

    const [turn, ...children] = spans;
    expect(turn.name).toBe('invoke_agent ally_guide');
    expect(turn.attributes).toMatchObject({
      [GEN_AI.OPERATION_NAME]: 'invoke_agent',
      [GEN_AI.AGENT_NAME]: 'ally_guide',
      [GEN_AI.CONVERSATION_ID]: 'thread-1',
      [AGENT_ATTR.TURN_ID]: 'turn-1',
      [AGENT_ATTR.OUTCOME]: 'stopped',
    });
    // 'model' was skipped after the stop, so it has no span.
    expect(children.map((s) => s.name)).toEqual([
      'agent.stage admit',
      'agent.stage reply',
      'agent.stage finish',
    ]);
    for (const child of children) {
      expect(child.parent?.spanId).toBe(turn.ctx.spanId);
    }
    expect(spans.every((s) => s.ended)).toBe(true);
  });

  it('marks the failing stage and the turn as errors, by code only', async () => {
    const outcome = await runHarnessStages(makeCtx(), [
      stage('admit', () => {
        throw new HarnessStageError('turn_in_progress', LEARNER_TEXT);
      }),
      stage('finish', () => undefined, true),
    ]);
    expect(outcome).toBe('failed');
    const [turn, admit, finish] = spans;
    expect(admit.status.code).toBe(SpanStatusCode.ERROR);
    expect(admit.attributes[AGENT_ATTR.ERROR_TYPE]).toBe('turn_in_progress');
    expect(finish.status.code).toBe(SpanStatusCode.UNSET);
    expect(turn.status.code).toBe(SpanStatusCode.ERROR);
    expect(turn.attributes[AGENT_ATTR.ERROR_TYPE]).toBe('turn_in_progress');
  });

  it('never puts learner text in any span attribute', async () => {
    await runHarnessStages(makeCtx(), [
      stage('reply', () => {
        throw new Error(LEARNER_TEXT);
      }),
    ]);
    const values = spans.flatMap((s) => Object.values(s.attributes));
    expect(values.some((v) => String(v).includes('client'))).toBe(false);
  });

  it("continues the browser's trace when a traceparent arrives", async () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    await runHarnessStages(
      makeCtx({
        traceCarrier: {
          traceparent: `00-${traceId}-00f067aa0ba902b7-01`,
        },
      }),
      [stage('admit')],
    );
    const [turn, admit] = spans;
    expect(turn.parent).toMatchObject({
      traceId,
      spanId: '00f067aa0ba902b7',
      isRemote: true,
    });
    expect(admit.ctx.traceId).toBe(traceId);
  });
});
