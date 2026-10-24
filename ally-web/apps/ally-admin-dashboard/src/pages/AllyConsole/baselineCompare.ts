import { AllyGuideBaselineCohort, AllyGuideBaselineSnapshot } from "@types";

export type BaselineMetricKey =
  | "enrollments"
  | "completionRate"
  | "medianDaysToComplete"
  | "itemsCompletedPerEnrollment"
  | "firstDayWinRate"
  | "returnWithin7dRate"
  | "quizFirstAttemptPassRate";

export type BaselineGroup = "volume" | "engagement" | "learning";
export type BaselineKind = "count" | "rate" | "days" | "items";

export interface BaselineMetric {
  key: BaselineMetricKey;
  group: BaselineGroup;
  kind: BaselineKind;
  /** True: higher is the good direction. False: lower is. Null: a volume, with no good direction. */
  higherIsBetter: boolean | null;
}

/**
 * The metrics, grouped the way the plan reads them (§4.13): engagement and learning apart, so the
 * guard "engagement up while learning is flat or falling is reverted" is something the eye can check.
 */
export const BASELINE_METRICS: BaselineMetric[] = [
  { key: "enrollments", group: "volume", kind: "count", higherIsBetter: null },
  { key: "completionRate", group: "engagement", kind: "rate", higherIsBetter: true },
  { key: "medianDaysToComplete", group: "engagement", kind: "days", higherIsBetter: false },
  { key: "itemsCompletedPerEnrollment", group: "engagement", kind: "items", higherIsBetter: true },
  { key: "firstDayWinRate", group: "engagement", kind: "rate", higherIsBetter: true },
  { key: "returnWithin7dRate", group: "engagement", kind: "rate", higherIsBetter: true },
  { key: "quizFirstAttemptPassRate", group: "learning", kind: "rate", higherIsBetter: true },
];

export const BASELINE_GROUPS: BaselineGroup[] = ["volume", "engagement", "learning"];

/** The order cohorts are offered in; "all" is the whole window and is always shown last. */
export const COHORT_ORDER = ["guided", "public_link", "in_app", "outreach", "unknown"] as const;

/** The cohorts of a snapshot that have anyone in them, in the order above. */
export const visibleCohorts = (snapshot: AllyGuideBaselineSnapshot): string[] =>
  COHORT_ORDER.filter(cohort => (snapshot.metrics.cohorts[cohort]?.enrollments ?? 0) > 0);

export const cohortValue = (
  cohort: AllyGuideBaselineCohort | undefined,
  key: BaselineMetricKey,
): number | null => {
  const value = cohort?.[key];
  return value === undefined || value === null ? null : value;
};

export interface BaselineDifference {
  text: string | null;
  direction: "better" | "worse" | "same" | null;
}

const NEGLIGIBLE: Record<Exclude<BaselineKind, "count">, number> = {
  rate: 0.0005, // 0.05 points
  days: 0.05,
  items: 0.05,
};

/** Guided minus baseline, in the metric's unit, and whether that is the good direction. */
export const baselineDifference = (
  metric: BaselineMetric,
  baseline: number | null,
  guided: number | null,
): BaselineDifference => {
  if (metric.kind === "count" || baseline === null || guided === null) {
    return { text: null, direction: null };
  }
  const delta = guided - baseline;
  const size = Math.abs(delta);
  if (size < NEGLIGIBLE[metric.kind]) return { text: "No difference", direction: "same" };
  const sign = delta > 0 ? "+" : "−";
  const magnitude =
    metric.kind === "rate"
      ? `${(size * 100).toFixed(1)} pts`
      : metric.kind === "days"
        ? `${size.toFixed(1)} days`
        : size.toFixed(1);
  return {
    text: `${sign}${magnitude}`,
    direction: delta > 0 === metric.higherIsBetter ? "better" : "worse",
  };
};

/**
 * The snapshots to read against each other: the newest, and the first ever taken (the pre-launch
 * baseline). Null `first` when there is only one, since a snapshot is not a comparison with itself.
 * `snapshots` is newest first, as the API returns it.
 */
export const pickSnapshots = (
  snapshots: AllyGuideBaselineSnapshot[] | undefined,
): { latest: AllyGuideBaselineSnapshot | null; first: AllyGuideBaselineSnapshot | null } => {
  if (!snapshots?.length) return { latest: null, first: null };
  const latest = snapshots[0];
  // The server marks the very first snapshot ever taken and always includes it, even beyond the
  // page. Without a mark (an older server) the oldest listed is the best available.
  const first = snapshots.find(snapshot => snapshot.first) ?? snapshots[snapshots.length - 1];
  return { latest, first: first.id === latest.id ? null : first };
};

/** The window a snapshot may read, in days (`GuideBaselineCaptureDto`). */
export const BASELINE_WINDOW_MIN = 7;
export const BASELINE_WINDOW_MAX = 365;
export const BASELINE_WINDOW_DEFAULT = 90;

/** How many snapshots one read asks for (the server's cap); the first ever is always added to them. */
export const BASELINE_LIST_LIMIT = 100;

/** A window typed as plain digits, in range, or null. Read strictly, as the canary share is. */
export const parseBaselineWindow = (text: string): number | null => {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= BASELINE_WINDOW_MIN && value <= BASELINE_WINDOW_MAX ? value : null;
};

/** The engagement measures the guard looks at. */
const GUARD_ENGAGEMENT: BaselineMetricKey[] = [
  "completionRate",
  "firstDayWinRate",
  "returnWithin7dRate",
];

export interface EngagementLearningGuard {
  /** Engagement is up on at least two of three measures while quiz first-attempt pass is lower. */
  triggered: boolean;
  improved: BaselineMetricKey[];
  baselinePass: number | null;
  guidedPass: number | null;
  guidedEnrollments: number;
  baselineEnrollments: number;
  guidedQuizAttempts: number;
}

/**
 * The plan's guard (§4.13): if engagement rises while learning is flat or falling, the change is
 * reverted. This flags the clear case only: two or more of completion, first-day win and 7-day
 * return are higher for guided learners than the baseline, AND quiz first-attempt pass is strictly
 * lower. "Flat" is left to the reader, because with cohorts this small any tolerance would be
 * invented; the cohort sizes are returned so the message can show them.
 */
export const engagementLearningGuard = (
  first: AllyGuideBaselineSnapshot,
  latest: AllyGuideBaselineSnapshot,
): EngagementLearningGuard | null => {
  const baseline = first.metrics.cohorts.all;
  const guided = latest.metrics.cohorts.guided;
  if (!baseline || !guided || guided.enrollments === 0) return null;
  const improved = GUARD_ENGAGEMENT.filter(key => {
    const before = cohortValue(baseline, key);
    const now = cohortValue(guided, key);
    return before !== null && now !== null && now > before;
  });
  const baselinePass = cohortValue(baseline, "quizFirstAttemptPassRate");
  const guidedPass = cohortValue(guided, "quizFirstAttemptPassRate");
  const learningLower = baselinePass !== null && guidedPass !== null && guidedPass < baselinePass;
  return {
    triggered: improved.length >= 2 && learningLower,
    improved,
    baselinePass,
    guidedPass,
    guidedEnrollments: guided.enrollments,
    baselineEnrollments: baseline.enrollments,
    guidedQuizAttempts: guided.quizFirstAttempts,
  };
};
