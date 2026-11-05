import { randomUUID } from 'crypto';
import { v5 as uuidv5 } from 'uuid';
import type { KnowledgeAnswerResponse } from '../../ai/dto/knowledge.dto';
import { AiUpstreamError } from '../../ai/exception/ai-upstream.exception';
import { ErrorCode } from '../../exception/error-code.enum';
import type { WhatsAppBotSettings } from '../../whatsapp/type/whatsapp-settings.type';
import type { Chatbot } from '../entity/chatbot.entity';
import type { AgentShadowSide } from '../entity/agent-shadow-run.entity';
import { ChatbotRuntime } from '../enum/chatbot.enum';

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

/** `/agent/run` answered 200 with something that is not an answer. */
export class MalformedAgentResponseError extends Error {
  constructor() {
    super('/agent/run returned a response without an intent');
    this.name = 'MalformedAgentResponseError';
  }
}

/**
 * A short, stable key for why `/agent/run` failed: what the degraded alert is throttled on, and
 * what a shadow row records. Codes and statuses only — never a message that could echo the request.
 */
export const agentFailureReason = (error: unknown): string => {
  if (error instanceof MalformedAgentResponseError) return 'malformed';
  if (error instanceof AiUpstreamError) {
    if (error.errorCode === ErrorCode.AI_SERVICE_TIMEOUT) return 'timeout';
    if (error.upstreamStatus) return `upstream_${error.upstreamStatus}`;
    return 'unavailable';
  }
  return 'unknown';
};

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
