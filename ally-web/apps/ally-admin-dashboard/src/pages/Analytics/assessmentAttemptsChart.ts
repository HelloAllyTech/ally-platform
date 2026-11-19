/**
 * Pure transforms + wire types for the Highlights -> Course impact "Single valid
 * assessment attempts" card (AAQ-255).
 *
 * Mirrors ally-be's `GET /v1/analytics/assessment-attempts`
 * (src/analytics/service/assessment-attempts-analytics.service.ts). A unit is one
 * learner x one assessment roleplay; "single valid" means exactly one valid
 * attempt and no trainer reopen. `share` is a 0-1 fraction, null when there are
 * no units. Incomplete starts are reported beside the share, never subtracted.
 */

export interface AssessmentAttemptsWeek {
  /** Monday, YYYY-MM-DD. */
  week: string;
  units: number;
  singleValid: number;
  share: number | null;
  incompleteStarts: number;
}

export interface AssessmentAttemptsResponse {
  totals: {
    units: number;
    singleValid: number;
    share: number | null;
    incompleteStarts: number;
    incompleteStartsPerUnit: number | null;
  };
  weeks: AssessmentAttemptsWeek[];
}

export const UNITS_GROUP = "Units (learner x assessment)";
export const SHARE_GROUP = "Single valid attempt share";

export const ASSESSMENT_ATTEMPTS_NOTE =
  "Sessions before minimum turns existed were counted at one turn.";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-16" -> "16 Nov" (no timezone maths: the server date is the label). */
export const weekLabel = (week: string): string => {
  const [, month, day] = week.split("-").map(Number);
  if (!month || !day) return week;
  return `${day} ${MONTHS[month - 1]}`;
};

/** A 0-1 fraction as a whole percent, or an em dash when there is none. */
export const formatShare = (share: number | null | undefined): string =>
  share == null ? "\u2014" : `${Math.round(share * 100)}%`;

export const formatPerUnit = (value: number | null | undefined): string =>
  value == null ? "\u2014" : String(Number(value.toFixed(2)));

export interface AssessmentAttemptsDatum {
  group: string;
  key: string;
  value: number;
}

/**
 * One bar per week (units) and one line point per week (share, in percent). A
 * week with no units has no share, so the line leaves a gap rather than a 0.
 * Labels fall back to the full date if two weeks would share a short label.
 */
export const buildAssessmentAttemptsSeries = (
  data: AssessmentAttemptsResponse | undefined,
): AssessmentAttemptsDatum[] => {
  const weeks = data?.weeks ?? [];
  const short = weeks.map(w => weekLabel(w.week));
  const unique = new Set(short).size === short.length;
  return weeks.flatMap((w, i) => {
    const key = unique ? short[i] : w.week;
    const points: AssessmentAttemptsDatum[] = [{ group: UNITS_GROUP, key, value: w.units }];
    if (w.share !== null) {
      points.push({ group: SHARE_GROUP, key, value: Math.round(w.share * 1000) / 10 });
    }
    return points;
  });
};

export const assessmentAttemptsEmptyText = (data: AssessmentAttemptsResponse | undefined) =>
  !data || data.totals.units === 0 ? "No learner has taken an assessment roleplay yet" : "";

export const assessmentAttemptsTakeaway = (
  data: AssessmentAttemptsResponse | undefined,
): string | undefined => {
  if (!data || data.totals.units === 0 || data.totals.share === null) return undefined;
  const { units, singleValid, share } = data.totals;
  return `${formatShare(share)} of ${units} assessment unit${units === 1 ? "" : "s"} (${singleValid}) had exactly one valid attempt.`;
};
