import { meetsMinimumScore } from 'src/common/util/progression.util';
import {
  ASSESSMENT_MAX_LEARNER_TURNS,
  ASSESSMENT_MIN_LEARNER_TURNS,
  RoleplayAttemptFailureReason,
  RoleplayType,
  TrackItemCompletionCriteria,
  TrackItemCompletionLogic,
} from '../type/track.type';

/**
 * The gates a ROLEPLAY track item actually applies, after defaults. Every
 * reader — the progression engine, the learner payloads, the course copilot —
 * goes through `resolveRoleplayGate` so they cannot disagree about what an
 * item requires.
 */
export interface RoleplayGate {
  roleplayType: RoleplayType;
  completionLogic: TrackItemCompletionLogic;
  /** Null when no score gate applies (logic excludes it, or no positive minimum). */
  minScore: number | null;
  /**
   * Null when no duration gate applies (logic excludes it, it resolves to 0,
   * or the item is an assessment — min turns replaces duration there).
   */
  minDurationSeconds: number | null;
  /** Assessment only: learner turns a valid attempt needs. Null otherwise. */
  minLearnerTurns: number | null;
}

const LOGICS = new Set<string>(Object.values(TrackItemCompletionLogic));

/**
 * `completionLogic` as stored, or SCORE_AND_DURATION when it is absent or
 * unrecognised: that is how every roleplay item behaved before the field
 * existed, so an item nobody has touched keeps its old rule.
 */
export const roleplayCompletionLogic = (
  criteria: TrackItemCompletionCriteria | null | undefined,
): TrackItemCompletionLogic => {
  const raw = criteria?.completionLogic;
  return raw && LOGICS.has(raw)
    ? raw
    : TrackItemCompletionLogic.SCORE_AND_DURATION;
};

/**
 * The platform-wide minimum duration (SCENARIO_PATH_ITEM_MIN_DURATION_FOR_COMPLETION).
 * The env var is validated as a string, so it arrives as one; anything that is
 * not a non-negative number reads as no minimum.
 */
export const parseDefaultMinDurationSeconds = (raw: unknown): number => {
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
};

/**
 * The trainer-facing roleplay type, derived from the stored keys so there is
 * one source of truth: assessmentMode wins, then PARTICIPATION is a trial,
 * and every gated logic is practice.
 */
export const resolveRoleplayType = (
  criteria: TrackItemCompletionCriteria | null | undefined,
): RoleplayType => {
  if (criteria?.assessmentMode) return RoleplayType.ASSESSMENT;
  return roleplayCompletionLogic(criteria) ===
    TrackItemCompletionLogic.PARTICIPATION
    ? RoleplayType.TRIAL
    : RoleplayType.PRACTICE;
};

/**
 * An assessment's minimum learner turns, clamped to the allowed range.
 * Absent reads as 1 — the rule every assessment had before the field existed.
 */
export const resolveMinLearnerTurns = (
  criteria: TrackItemCompletionCriteria | null | undefined,
): number => {
  const raw = criteria?.minLearnerTurns;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return ASSESSMENT_MIN_LEARNER_TURNS;
  }
  return Math.min(
    ASSESSMENT_MAX_LEARNER_TURNS,
    Math.max(ASSESSMENT_MIN_LEARNER_TURNS, Math.floor(raw)),
  );
};

/** Absent reads as true: assessments always showed results before the field. */
export const showsResultsToLearner = (
  criteria: TrackItemCompletionCriteria | null | undefined,
): boolean =>
  !criteria?.assessmentMode || criteria.showResultsToLearner !== false;

export const resolveRoleplayGate = (
  criteria: TrackItemCompletionCriteria | null | undefined,
  defaultMinDurationSeconds: number,
): RoleplayGate => {
  const completionLogic = roleplayCompletionLogic(criteria);
  const roleplayType = resolveRoleplayType(criteria);
  const isAssessment = roleplayType === RoleplayType.ASSESSMENT;
  const scoreGated =
    completionLogic === TrackItemCompletionLogic.SCORE ||
    completionLogic === TrackItemCompletionLogic.SCORE_AND_DURATION;
  const durationGated =
    !isAssessment &&
    (completionLogic === TrackItemCompletionLogic.DURATION ||
      completionLogic === TrackItemCompletionLogic.SCORE_AND_DURATION);

  const rawMinScore = criteria?.minScore;
  // Same rule as meetsMinimumScore: 0 or less is "no bar".
  const minScore =
    scoreGated && typeof rawMinScore === 'number' && rawMinScore > 0
      ? rawMinScore
      : null;

  // A per-item minimum wins, 0 included (an explicit "no minimum"); absent
  // falls back to the platform default.
  const rawDuration = criteria?.minDurationSeconds;
  const resolvedDuration =
    typeof rawDuration === 'number' && rawDuration >= 0
      ? rawDuration
      : defaultMinDurationSeconds;
  const minDurationSeconds =
    durationGated && resolvedDuration > 0 ? resolvedDuration : null;

  return {
    roleplayType,
    completionLogic,
    minScore,
    minDurationSeconds,
    minLearnerTurns: isAssessment ? resolveMinLearnerTurns(criteria) : null,
  };
};

/**
 * Collapse a transcript's sender ids, in order, into learner turns: a run of
 * consecutive learner messages is one turn. The simulated client's messages
 * are stored with senderId -1; everything else is the learner.
 */
export const countLearnerTurnsFromSenders = (senderIds: number[]): number => {
  let turns = 0;
  let previousWasLearner = false;
  for (const senderId of senderIds) {
    const isLearner = senderId !== -1;
    if (isLearner && !previousWasLearner) turns += 1;
    previousWasLearner = isLearner;
  }
  return turns;
};

/**
 * Which gates an ended attempt missed. Empty means it completes the item.
 * Both gates are checked, never short-circuited, so a learner who missed both
 * is told about both.
 */
export const roleplayFailureReasons = (
  gate: RoleplayGate,
  {
    score,
    durationSeconds,
    learnerTurns,
  }: {
    score?: number | null;
    durationSeconds: number;
    learnerTurns?: number;
  },
): RoleplayAttemptFailureReason[] => {
  const reasons: RoleplayAttemptFailureReason[] = [];
  if (
    gate.minLearnerTurns !== null &&
    typeof learnerTurns === 'number' &&
    learnerTurns < gate.minLearnerTurns
  ) {
    reasons.push(RoleplayAttemptFailureReason.INSUFFICIENT_TURNS);
  }
  if (
    gate.roleplayType !== RoleplayType.ASSESSMENT &&
    gate.completionLogic === TrackItemCompletionLogic.PARTICIPATION
  ) {
    return reasons;
  }
  if (
    gate.minDurationSeconds !== null &&
    durationSeconds < gate.minDurationSeconds
  ) {
    reasons.push(RoleplayAttemptFailureReason.INSUFFICIENT_DURATION);
  }
  if (!meetsMinimumScore(score, gate.minScore)) {
    reasons.push(RoleplayAttemptFailureReason.INSUFFICIENT_SCORE);
  }
  return reasons;
};
