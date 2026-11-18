/**
 * The per-hit score of a behaviour class in a roleplay's scoring rubric.
 *
 * Mirrors ally-be's `BehaviorInstructionDto.score`: an integer in [-100, 100]
 * whose sign follows the category (a "should do" never takes points away, a
 * "should not do" never awards them; 0 is allowed on either). An unset score
 * means the category default (+10 / -10), which is what every roleplay authored
 * before the score was editable runs on.
 */

export const BEHAVIOUR_SCORE_MIN = -100;
export const BEHAVIOUR_SCORE_MAX = 100;
export const BEHAVIOUR_SHOULD_DO_DEFAULT_SCORE = 10;
export const BEHAVIOUR_SHOULD_NOT_DO_DEFAULT_SCORE = -10;

const SHOULD_DO = "SHOULD_DO";

export const defaultBehaviourScore = (category?: string): number =>
  category === SHOULD_DO
    ? BEHAVIOUR_SHOULD_DO_DEFAULT_SCORE
    : BEHAVIOUR_SHOULD_NOT_DO_DEFAULT_SCORE;

/** The score a row is actually worth: the authored one, else the category default. */
export const effectiveBehaviourScore = (category?: string, score?: number | null): number =>
  typeof score === "number" ? score : defaultBehaviourScore(category);

/** The allowed range for a category, inclusive. */
export const behaviourScoreRange = (category?: string): { min: number; max: number } =>
  category === SHOULD_DO
    ? { min: 0, max: BEHAVIOUR_SCORE_MAX }
    : { min: BEHAVIOUR_SCORE_MIN, max: 0 };

export type BehaviourScoreCheck = { ok: true; value: number } | { ok: false; error: string };

/** Validate what an author typed. Never coerces: a bad value is an error, not a silent fix. */
export const validateBehaviourScore = (raw: string, category?: string): BehaviourScoreCheck => {
  const text = raw.trim();
  if (text === "") return { ok: false, error: "Enter a whole number" };
  if (!/^[+-]?\d+(\.\d+)?$/.test(text)) return { ok: false, error: "Enter a whole number" };
  const num = Number(text);
  if (!Number.isInteger(num)) return { ok: false, error: "Whole numbers only" };
  if (num < BEHAVIOUR_SCORE_MIN || num > BEHAVIOUR_SCORE_MAX) {
    return { ok: false, error: `Between ${BEHAVIOUR_SCORE_MIN} and ${BEHAVIOUR_SCORE_MAX}` };
  }
  const { min, max } = behaviourScoreRange(category);
  if (num < min || num > max) {
    return {
      ok: false,
      error:
        category === SHOULD_DO
          ? `Should do: 0 to ${BEHAVIOUR_SCORE_MAX}`
          : `Should not do: ${BEHAVIOUR_SCORE_MIN} to 0`,
    };
  }
  // `-0` is a valid thing to type but must not reach form state as negative zero.
  return { ok: true, value: num === 0 ? 0 : num };
};

/**
 * Whether two rows' scores are interchangeable, so a tag can sit in either: both
 * unset (category default) or the same authored number.
 */
export const sameBehaviourScore = (a?: number | null, b?: number | null): boolean =>
  (typeof a === "number" ? a : null) === (typeof b === "number" ? b : null);
