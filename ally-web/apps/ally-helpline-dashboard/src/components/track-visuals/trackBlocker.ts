import { TFunction } from "i18next";

import { TrackBlocker, TrackBlockerReason } from "@types";

import { formatRoleplayDuration } from "./roleplayRequirement";

/** Types whose BELOW_SCORE numbers are percentages; roleplay/case use points. */
const PERCENT_SCORE_TYPES = new Set(["QUIZ", "ANNOTATED_ARTIFACT", "BRANCHING_SCENARIO"]);

const KNOWN_CODES = new Set<TrackBlockerReason>([
  "NOT_FINISHED",
  "BELOW_SCORE",
  "TOO_SHORT",
  "NOT_SCORED",
  "ASSESSMENT_FAILED",
  "GRADING_PENDING",
  "OUT_OF_ATTEMPTS",
  "WATCH_MORE",
  "KEEP_READING",
]);

const formatDate = (iso: string, locale: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Latin digits regardless of locale, matching getFormattedDate.
  return d.toLocaleDateString(`${locale}-u-nu-latn`, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
};

/**
 * One line per reason a locked item is blocked. Unknown reason codes fall
 * back to the generic "finish the previous item" line.
 */
export const formatTrackBlocker = (
  blocker: TrackBlocker,
  t: TFunction,
  locale = "en",
): string[] => {
  const title = blocker.title;
  const lines = blocker.reasons.map(reason => {
    const code = KNOWN_CODES.has(reason.code) ? reason.code : "NOT_FINISHED";
    const actual = reason.actual ?? 0;
    const required = reason.required ?? 0;
    switch (code) {
      case "BELOW_SCORE": {
        const suffix = PERCENT_SCORE_TYPES.has(blocker.type) ? "%" : "";
        return t("tracks2.blocker.belowScore", {
          title,
          actual: `${actual}${suffix}`,
          required: `${required}${suffix}`,
        });
      }
      case "TOO_SHORT":
        return t("tracks2.blocker.tooShort", {
          title,
          actual: formatRoleplayDuration(actual, t),
          required: formatRoleplayDuration(required, t),
        });
      case "NOT_SCORED":
        return t("tracks2.blocker.notScored", { title });
      case "ASSESSMENT_FAILED":
        return t("tracks2.blocker.assessmentFailed", { title });
      case "GRADING_PENDING":
        return t("tracks2.blocker.gradingPending", { title });
      case "OUT_OF_ATTEMPTS": {
        const date = blocker.retryAt ? formatDate(blocker.retryAt, locale) : "";
        return date
          ? t("tracks2.blocker.outOfAttemptsUntil", { title, date })
          : t("tracks2.blocker.outOfAttempts", { title });
      }
      case "WATCH_MORE":
        return t("tracks2.blocker.watchMore", { title, actual, required });
      case "KEEP_READING":
        return t("tracks2.blocker.keepReading", { title });
      default:
        return t("tracks2.blocker.notFinished", { title });
    }
  });
  return lines.length ? lines : [t("tracks2.blocker.notFinished", { title })];
};
