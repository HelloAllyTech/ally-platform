import type { Chatbot } from '../entity/chatbot.entity';
import type { AgentFailureReason } from '../engine/chatbot-engine.types';

// The Agents v2 event. In-process only (EventEmitter2): the channel emits it after it has
// replied, so a listener can never delay, fail or redeliver the message.

/**
 * A bot's run failed and the fixed run-failed reply went out (Q3-fast: there is no v1 fallback;
 * the event keeps its name). Emitted by the channel after it replied; the listener raises the
 * throttled "agent runtime degraded" alert.
 */
export const AGENT_FALLBACK_EVENT = 'chatbot.agent-fallback';
export interface AgentFallbackEvent {
  chatbot: Pick<Chatbot, 'id' | 'name'>;
  reason: AgentFailureReason;
}
