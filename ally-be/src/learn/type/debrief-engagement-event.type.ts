/**
 * Signals that a learner's debrief conversation has become substantive.
 *
 * Declared beside the emitter rather than in the progress module, so that module stays
 * a leaf: nothing in `src/progress` is imported by the code it reacts to. `TRACK_EVENTS`
 * follows the same pattern.
 */
export enum DebriefEngagementEvent {
  THREAD_QUALIFIED = 'DEBRIEF_THREAD_QUALIFIED',
  /** A Debrief-agent debrief read to the end of its last Work-on-this card. */
  READ_QUALIFIED = 'DEBRIEF_READ_QUALIFIED',
  /** A genuine answer to a Debrief-agent debrief's reflective question. */
  REFLECTION_QUALIFIED = 'DEBRIEF_REFLECTION_QUALIFIED',
}

export interface DebriefThreadQualifiedEventParams {
  userId: number;
  tenantId: string;
  scenarioSessionId: string;
}

/**
 * What makes a debrief conversation worth XP.
 *
 * Three replies rather than one, because a single "ok, thanks" is not a conversation;
 * and a character floor per reply, because three of those are not a conversation either.
 * Both are deliberately low — the aim is to exclude the reflex reply, not to grade
 * whether the learner reflected well. Judging that would mean an LLM marking sincerity,
 * which is neither cheap nor fair.
 */
export const DEBRIEF_MIN_SUBSTANTIVE_REPLIES = 3;
export const DEBRIEF_MIN_REPLY_CHARS = 25;

/** Whether one learner reply counts toward the floor. */
export const isSubstantiveDebriefReply = (content: string): boolean =>
  (content ?? '').trim().length >= DEBRIEF_MIN_REPLY_CHARS;

/** The fewest words a reflective answer earns XP for (v9 FR-65). */
export const DEBRIEF_REFLECTION_MIN_WORDS = 15;
/** A run of this many words found in the debrief means the answer was copied. */
const COPIED_RUN_WORDS = 8;

const words = (text: string) =>
  (text ?? '')
    .toLowerCase()
    .normalize('NFC')
    .split(/[^\p{L}\p{M}\p{N}']+/u)
    .filter(Boolean);

/**
 * Whether an answer to the reflective question earns XP: long enough to be
 * an answer, and not copied from the debrief. Deliberately not judged by a
 * model for sincerity (see DEBRIEF_MIN_SUBSTANTIVE_REPLIES above).
 */
export const isGenuineReflection = (
  answer: string,
  debriefTexts: string[],
): boolean => {
  const said = words(answer);
  if (said.length < DEBRIEF_REFLECTION_MIN_WORDS) return false;
  const source = ` ${debriefTexts.map((t) => words(t).join(' ')).join(' | ')} `;
  for (let i = 0; i + COPIED_RUN_WORDS <= said.length; i++) {
    if (source.includes(` ${said.slice(i, i + COPIED_RUN_WORDS).join(' ')} `)) {
      return false;
    }
  }
  return true;
};
