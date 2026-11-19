import { TFunction } from "i18next";

import { LastRoleplayAttempt, RoleplayGate } from "@types";

/** "1 min 30 sec", "3 min", "45 sec". */
export const formatRoleplayDuration = (totalSeconds: number, t: TFunction): string => {
  const total = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes > 0 && seconds > 0) {
    return t("tracks2.roleplay.duration.minutesSeconds", { minutes, seconds });
  }
  if (minutes > 0) return t("tracks2.roleplay.duration.minutes", { minutes });
  return t("tracks2.roleplay.duration.seconds", { seconds });
};

/**
 * One sentence telling the learner what this roleplay asks of them before
 * they start, or null when it asks nothing (no gate at all, and not a
 * participation item worth calling out).
 */
export const getRoleplayRequirement = (
  gate: RoleplayGate | undefined,
  t: TFunction,
): string | null => {
  if (!gate) return null;
  const { completionLogic, minScore, minDurationSeconds } = gate;
  // An assessment is judged on turns, never duration.
  if (gate.roleplayType === "ASSESSMENT" && gate.minLearnerTurns != null) {
    const turns = gate.minLearnerTurns;
    return minScore != null && minScore > 0
      ? t("tracks2.roleplay.requirement.turnsAndScore", { turns, score: minScore })
      : t("tracks2.roleplay.requirement.turns", { turns });
  }
  if (completionLogic === "PARTICIPATION") return t("tracks2.roleplay.requirement.participation");
  const duration =
    minDurationSeconds != null ? formatRoleplayDuration(minDurationSeconds, t) : null;
  if (minScore != null && duration) {
    return t("tracks2.roleplay.requirement.scoreAndDuration", { score: minScore, duration });
  }
  if (minScore != null) return t("tracks2.roleplay.requirement.score", { score: minScore });
  if (duration) return t("tracks2.roleplay.requirement.duration", { duration });
  return null;
};

/**
 * One line per gate the learner's last attempt missed — duration first, then
 * score — so a learner who missed both is told about both.
 */
export const getRoleplayFailureLines = (attempt: LastRoleplayAttempt, t: TFunction): string[] => {
  const lines: string[] = [];
  const reasons = attempt.failureReasons ?? [];
  if (reasons.includes("INSUFFICIENT_DURATION") && attempt.requiredDurationSeconds != null) {
    lines.push(
      t("tracks2.roleplay.lastAttempt.duration", {
        actual: formatRoleplayDuration(attempt.durationSeconds, t),
        required: formatRoleplayDuration(attempt.requiredDurationSeconds, t),
      }),
    );
  }
  if (reasons.includes("INSUFFICIENT_SCORE") && attempt.requiredScore != null) {
    lines.push(
      attempt.score != null
        ? t("tracks2.roleplay.lastAttempt.score", {
            score: attempt.score,
            required: attempt.requiredScore,
          })
        : t("tracks2.roleplay.lastAttempt.scoreMissing", { required: attempt.requiredScore }),
    );
  }
  return lines;
};

/**
 * The "too short to count" notice for an assessment attempt that spoke but
 * fell under the turn minimum, or null when that wasn't the reason.
 */
export const getRoleplayShortAttemptLine = (
  attempt: LastRoleplayAttempt,
  t: TFunction,
): string | null => {
  if (!(attempt.failureReasons ?? []).includes("INSUFFICIENT_TURNS")) return null;
  if (attempt.requiredTurns == null) return null;
  return t("tracks2.roleplay.shortAttempt", {
    taken: attempt.learnerTurns ?? 0,
    n: attempt.requiredTurns,
  });
};
