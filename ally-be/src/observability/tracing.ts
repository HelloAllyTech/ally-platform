import {
  Context,
  ROOT_CONTEXT,
  Span,
  SpanStatusCode,
  context,
  propagation,
  trace,
} from '@opentelemetry/api';

/**
 * OpenTelemetry spans for the agent harness (plans/ally-guide/plan.md §7.12).
 *
 * Only the vendor-neutral API is used here. Until an SDK registers a tracer
 * provider (a later bootstrap, once the collector and IAM exist), every call
 * is a no-op costing a function call — so instrumentation can land ahead of
 * the exporter and nothing changes at runtime.
 *
 * Content never enters a span. Attributes pass an allowlist of keys and short
 * id-like values (`spanAttributes`), and a failure records only its type or
 * code, never its message. Learner text, model output and tool payloads
 * belong to the product trace (agent_turn_traces + S3), which has retention
 * and deletion; a telemetry backend has neither.
 */

const TRACER_NAME = 'ally-be.agent-harness';

/** GenAI semantic-convention attribute names (OpenTelemetry, development). */
export const GEN_AI = {
  OPERATION_NAME: 'gen_ai.operation.name',
  AGENT_NAME: 'gen_ai.agent.name',
  CONVERSATION_ID: 'gen_ai.conversation.id',
  PROVIDER_NAME: 'gen_ai.provider.name',
  REQUEST_MODEL: 'gen_ai.request.model',
  USAGE_INPUT_TOKENS: 'gen_ai.usage.input_tokens',
  USAGE_OUTPUT_TOKENS: 'gen_ai.usage.output_tokens',
  TOOL_NAME: 'gen_ai.tool.name',
  TOOL_CALL_ID: 'gen_ai.tool.call.id',
} as const;

/** The harness's own attributes, generic across agents. */
export const AGENT_ATTR = {
  TURN_ID: 'agent.turn.id',
  STAGE: 'agent.stage',
  OUTCOME: 'agent.outcome',
  RELEASE_ID: 'agent.release.id',
  CHANNEL: 'agent.channel',
  TRIGGER: 'agent.trigger',
  TENANT_ID: 'agent.tenant_id',
  ERROR_TYPE: 'error.type',
} as const;

const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  ...Object.values(GEN_AI),
  ...Object.values(AGENT_ATTR),
]);

/** Ids, enum values and model names: short, no spaces beyond a separator. */
const SAFE_STRING = /^[\w.:@/-]{1,128}$/;

export type SpanAttributeInput = Record<
  string,
  string | number | boolean | null | undefined
>;

/** The allowlisted, content-free subset of `input`. Everything else is dropped. */
export function spanAttributes(
  input: SpanAttributeInput,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!ALLOWED_KEYS.has(key) || value === null || value === undefined) {
      continue;
    }
    if (typeof value === 'string' && !SAFE_STRING.test(value)) continue;
    if (typeof value === 'number' && !Number.isFinite(value)) continue;
    out[key] = value;
  }
  return out;
}

/** What a failure is, never what it said. */
export function errorType(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  if (typeof code === 'string' && SAFE_STRING.test(code)) return code;
  if (error instanceof Error && SAFE_STRING.test(error.name)) return error.name;
  return 'unknown';
}

/** W3C trace context as it arrives on a request (`traceparent`, `tracestate`). */
export interface TraceCarrier {
  traceparent?: string;
  tracestate?: string;
}

/** The parent context for work that continues a request's trace. */
export function parentContext(carrier?: TraceCarrier | null): Context {
  if (!carrier?.traceparent) return context.active();
  return propagation.extract(ROOT_CONTEXT, { ...carrier });
}

/**
 * Run `fn` inside an active span. A throw marks the span as an error (type
 * only) and is rethrown unchanged, so wrapping never alters control flow.
 */
export function withSpan<T>(
  name: string,
  attributes: SpanAttributeInput,
  fn: (span: Span) => Promise<T>,
  parent: Context = context.active(),
): Promise<T> {
  return trace
    .getTracer(TRACER_NAME)
    .startActiveSpan(
      name,
      { attributes: spanAttributes(attributes) },
      parent,
      async (span) => {
        try {
          return await fn(span);
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          span.setAttribute(AGENT_ATTR.ERROR_TYPE, errorType(error));
          throw error;
        } finally {
          span.end();
        }
      },
    );
}

/** Set allowlisted attributes on a live span. */
export function setSpanAttributes(span: Span, input: SpanAttributeInput): void {
  span.setAttributes(spanAttributes(input));
}
