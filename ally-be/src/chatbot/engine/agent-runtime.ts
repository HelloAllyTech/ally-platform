import { randomUUID } from 'crypto';
import { v5 as uuidv5 } from 'uuid';
import { AiUpstreamError } from '../../ai/exception/ai-upstream.exception';
import { ErrorCode } from '../../exception/error-code.enum';
import type { WhatsAppBotSettings } from '../../whatsapp/type/whatsapp-settings.type';
import type { AgentFailureReason, AgentRunRef } from './chatbot-engine.types';
import { AgentRuntimeUsed, ChatbotRuntime } from '../enum/chatbot.enum';

/**
 * The namespace Agents v2 run ids are derived under. Never change it: a run id stored on a message
 * must still be the one a redelivery of that message would derive.
 */
const AGENT_RUN_NAMESPACE = '54b53605-2385-4d61-8b44-a7fd03b0d1e9';

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
 * The engine that answers every chatbot: v2 with the conversational agent, unless the platform's
 * emergency switch (`agentRuntimeAllowed`, Defaults) is off — then v1, for every bot and every
 * caller, Preview included.
 */
export const effectiveRuntime = (
  settings: Pick<WhatsAppBotSettings, 'agentRuntimeAllowed'>,
): ChatbotRuntime.V1 | ChatbotRuntime.V2 =>
  settings.agentRuntimeAllowed ? ChatbotRuntime.V2 : ChatbotRuntime.V1;

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
