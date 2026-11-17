import { meetsMinimumScore } from 'src/common/util/progression.util';
import {
  RoleplayAttemptFailureReason,
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
  completionLogic: TrackItemCompletionLogic;
  /** Null when no score gate applies (logic excludes it, or no positive minimum). */
  minScore: number | null;
  /** Null when no duration gate applies (logic excludes it, or it resolves to 0). */
  minDurationSeconds: number | null;
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

export const resolveRoleplayGate = (
  criteria: TrackItemCompletionCriteria | null | undefined,
  defaultMinDurationSeconds: number,
): RoleplayGate => {
  const completionLogic = roleplayCompletionLogic(criteria);
  const scoreGated =
    completionLogic === TrackItemCompletionLogic.SCORE ||
    completionLogic === TrackItemCompletionLogic.SCORE_AND_DURATION;
  const durationGated =
    completionLogic === TrackItemCompletionLogic.DURATION ||
    completionLogic === TrackItemCompletionLogic.SCORE_AND_DURATION;

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

  return { completionLogic, minScore, minDurationSeconds };
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
  }: { score?: number | null; durationSeconds: number },
): RoleplayAttemptFailureReason[] => {
  if (gate.completionLogic === TrackItemCompletionLogic.PARTICIPATION) {
    return [];
  }
  const reasons: RoleplayAttemptFailureReason[] = [];
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
