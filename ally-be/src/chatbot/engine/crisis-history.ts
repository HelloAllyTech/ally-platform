import type { CrisisCheckRequest } from '../../ai/dto/knowledge.dto';
import type { ChatTurn } from './chatbot-engine.types';

/** The person's earlier messages the crisis check sees (ally-ai trims to the same limits). */
export const MAX_CRISIS_HISTORY_MESSAGES = 5;
export const MAX_CRISIS_HISTORY_CHARS = 1500;

/**
 * The person's own earlier messages in this conversation, for the crisis check (chunk 15a): newest
 * last, without the message being checked, at most 5 and 1,500 characters. "I mean it" is risk
 * only after a disclosure; "and what if I miss a day?" is ordinary after a question about streaks.
 *
 * Never the assistant's replies: the classifier judges the person, and the crisis reply's own
 * wording would tip every later message.
 *
 * WhatsApp and the bot page store the message before answering, so their history already ends
 * with it; Preview's doesn't. Dropping a last entry that IS the current message covers both.
 */
export function crisisHistory(
  turn: Pick<ChatTurn, 'text' | 'history'>,
): string[] {
  const turns = [...(turn.history ?? [])];
  const last = turns[turns.length - 1];
  if (last?.role === 'user' && last.content?.trim() === turn.text.trim()) {
    turns.pop();
  }
  const messages = turns
    .filter((t) => t.role === 'user')
    .map((t) => (t.content ?? '').trim())
    .filter(Boolean)
    .slice(-MAX_CRISIS_HISTORY_MESSAGES);

  // Newest first against the budget: the message that crosses it keeps its end, older ones go.
  const kept: string[] = [];
  let budget = MAX_CRISIS_HISTORY_CHARS;
  for (let at = messages.length - 1; at >= 0 && budget > 0; at--) {
    let message = messages[at];
    if (message.length > budget) {
      message = budget > 1 ? `…${message.slice(-(budget - 1))}` : '…';
    }
    kept.unshift(message);
    budget -= message.length;
  }
  return kept;
}

/** The crisis check's request for a turn: `history` only when there is some (the old request otherwise). */
export function crisisRequest(
  turn: Pick<ChatTurn, 'text' | 'history'>,
  prompts: Record<string, unknown>,
): CrisisCheckRequest {
  const history = crisisHistory(turn);
  return {
    message: turn.text,
    ...(history.length ? { history } : {}),
    prompts,
  };
}
