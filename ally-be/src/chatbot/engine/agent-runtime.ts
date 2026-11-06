import { randomUUID } from 'crypto';
import { v5 as uuidv5 } from 'uuid';
import type { KnowledgeAnswerResponse } from '../../ai/dto/knowledge.dto';
import { AiUpstreamError } from '../../ai/exception/ai-upstream.exception';
import { ErrorCode } from '../../exception/error-code.enum';
import type { WhatsAppBotSettings } from '../../whatsapp/type/whatsapp-settings.type';
import type { Chatbot } from '../entity/chatbot.entity';
import type { AgentShadowSide } from '../entity/agent-shadow-run.entity';
import type {
  AgentFailureReason,
  AgentRunRef,
  ShadowRunRequest,
} from './chatbot-engine.types';
import { AgentRuntimeUsed, ChatbotRuntime } from '../enum/chatbot.enum';

/**
 * A v2 bot's message fell back to v1. Emitted by the channel after it replied; the listener raises
 * the throttled "agent runtime degraded" alert.
 */
export const AGENT_FALLBACK_EVENT = 'chatbot.agent-fallback';
export interface AgentFallbackEvent {
  chatbot: Pick<Chatbot, 'id' | 'name'>;
  reason: AgentFailureReason;
}

/**
 * A shadow bot's message has been answered by v1 and the reply recorded. The listener runs the same
 * request through the Agents v2 engine and stores the comparison.
 */
export const AGENT_SHADOW_RUN_EVENT = 'chatbot.agent-shadow-run';
export interface AgentShadowRunEvent {
  chatbotId: string;
  conversationId: string;
  inboundMessageId: string;
  shadow: ShadowRunRequest;
}

/**
 * The namespace Agents v2 run ids are derived under. Never change it: a run id stored on a message
 * must still be the one a redelivery of that message would derive.
 */
export const AGENT_RUN_NAMESPACE = '54b53605-2385-4d61-8b44-a7fd03b0d1e9';

/**
 * The run id for one inbound message: the same provider message id always gives the same run id,
 * so an SQS redelivery that gets past dedupe reuses its run rather than starting a second one.
 * Without a provider id (Preview), every test is a fresh run.
 */
export const agentRunIdFor = (providerMessageId?: string | null): string =>
  providerMessageId
    ? uuidv5(providerMessageId, AGENT_RUN_NAMESPACE)
    : randomUUID();

/**
 * The engine that answers: the bot's own `runtime` (or Preview's one-test override), unless the
 * platform kill switch is off — then v1, for every bot and every caller, Preview included.
 */
export const effectiveRuntime = (
  chatbot: Pick<Chatbot, 'runtime'>,
  settings: Pick<WhatsAppBotSettings, 'agentRuntimeAllowed'>,
  requested?: ChatbotRuntime | null,
): ChatbotRuntime =>
  settings.agentRuntimeAllowed
    ? (requested ?? chatbot.runtime ?? ChatbotRuntime.V1)
    : ChatbotRuntime.V1;

/**
 * The bot answers with the conversational agent: its effective engine is v2 (kill switch and
 * Preview override included) and its `features.agent` flag is on.
 */
export const isAgentMode = (
  chatbot: Pick<Chatbot, 'runtime' | 'features'>,
  settings: Pick<WhatsAppBotSettings, 'agentRuntimeAllowed'>,
  requested?: ChatbotRuntime | null,
): boolean =>
  effectiveRuntime(chatbot, settings, requested) === ChatbotRuntime.V2 &&
  chatbot.features?.agent === true;

/** `/agent/run` answered 200 with something that is not an answer. */
export class MalformedAgentResponseError extends Error {
  constructor() {
    super('/agent/run returned a response without an intent');
    this.name = 'MalformedAgentResponseError';
  }
}

/** Why `/agent/run` failed, as an {@link AgentFailureReason}. */
export const agentFailureReason = (error: unknown): AgentFailureReason => {
  if (error instanceof MalformedAgentResponseError) return 'malformed';
  if (error instanceof AiUpstreamError) {
    if (error.errorCode === ErrorCode.AI_SERVICE_TIMEOUT) return 'timeout';
    if (error.upstreamStatus) return `upstream_${error.upstreamStatus}`;
    return 'unavailable';
  }
  return 'unknown';
};

/** v1 answered because the v2 run failed. */
export const isFallback = (
  ref: AgentRunRef | undefined,
): ref is Extract<AgentRunRef, { runtime: AgentRuntimeUsed.V2_FALLBACK }> =>
  ref?.runtime === AgentRuntimeUsed.V2_FALLBACK;

/** One side of a shadow comparison: the fields the parity script compares, and no text. */
export const shadowSide = (
  response: KnowledgeAnswerResponse,
  latencyMs: number,
): AgentShadowSide => ({
  intent: response.intent,
  decline_reason: response.decline_reason,
  cited_chunk_ids: (response.citations ?? []).map((c) => c.chunk_id),
  hit_count: response.retrieval?.hit_count ?? null,
  top_similarity: response.retrieval?.top_similarity ?? null,
  latency_ms: latencyMs,
});
