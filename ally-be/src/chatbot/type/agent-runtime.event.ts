import type { Chatbot } from '../entity/chatbot.entity';
import type {
  AgentFailureReason,
  ShadowRunRequest,
} from '../engine/chatbot-engine.types';

// The Agents v2 events. In-process only (EventEmitter2): the channel emits them after it has
// replied, so a listener can never delay, fail or redeliver the message.

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
