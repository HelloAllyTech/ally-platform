import { AgentMessage } from 'src/llm-agent/type/agent-llm.type';
import { GuideMessageRole } from '../enum/guide.enum';
import { ConversationLine } from './guide-context';

/** The fields of a transcript row history replay needs. */
export interface HistoryRow {
  seq: number;
  role: GuideMessageRole;
  turnId?: string | null;
  content?: string | null;
  /** Learner rows: exactly what the turn's request added before the model ran. */
  renderedContent?: Record<string, any>[] | null;
  /** Ally rows: exactly what the model returned, thinking blocks included. */
  providerBlocks?: Record<string, any>[] | null;
}

/**
 * The model-visible history of an epoch, replayed byte for byte
 * (plans/ally-guide/plan.md §7.1 principle 6).
 *
 * Only COMPLETE exchanges are replayed: a turn contributes its learner
 * messages and its reply together, or not at all. A turn that failed or was
 * cut off never produced a valid exchange, so it is simply absent from what
 * the model sees (the learner still sees it on screen). That keeps the
 * history append-only and alternation-valid without ever writing a
 * placeholder the model did not say — and a `role: "system"` message is
 * always followed by the assistant turn the API requires after it.
 */
export function replayHistory(rows: HistoryRow[]): AgentMessage[] {
  const ordered = [...rows].sort((a, b) => a.seq - b.seq);
  const replyByTurn = new Map<string, HistoryRow>();
  for (const row of ordered) {
    if (
      row.role === GuideMessageRole.ALLY &&
      row.turnId &&
      row.providerBlocks?.length
    ) {
      replyByTurn.set(row.turnId, row);
    }
  }
  const out: AgentMessage[] = [];
  for (const row of ordered) {
    // The input side of an exchange: the learner's message, or the note a
    // platform event left for a turn it started.
    const isInput =
      row.role === GuideMessageRole.LEARNER ||
      row.role === GuideMessageRole.SYSTEM_NOTE;
    if (!isInput || !row.turnId || !row.renderedContent?.length) {
      continue;
    }
    const reply = replyByTurn.get(row.turnId);
    if (!reply) continue;
    out.push(...(row.renderedContent as AgentMessage[]));
    out.push(...(reply.providerBlocks as AgentMessage[]));
  }
  return out;
}

/** What the learner saw, for a new epoch's recap: the last few lines. */
export function recentConversation(
  rows: HistoryRow[],
  limit = 6,
): ConversationLine[] {
  return [...rows]
    .sort((a, b) => a.seq - b.seq)
    .filter(
      (row) =>
        (row.role === GuideMessageRole.LEARNER ||
          row.role === GuideMessageRole.ALLY) &&
        row.content?.trim(),
    )
    .slice(-limit)
    .map((row) => ({
      role: row.role === GuideMessageRole.LEARNER ? 'learner' : 'ally',
      text: row.content!.trim(),
    }));
}
