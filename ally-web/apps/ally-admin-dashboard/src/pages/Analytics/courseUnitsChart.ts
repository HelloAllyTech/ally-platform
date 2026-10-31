import { AnalyticsBucket, AnalyticsRange, AnalyticsScoping, AnalyticsWindow } from "@types";

import { CONTEXT, PALETTE } from "./chartScales";

/**
 * Pure transforms + wire types for the Goals -> "Course units consumed" card.
 *
 * Mirrors ally-be's `CourseUnitsResponseDto`
 * (src/analytics/dto/course-units-analytics.dto.ts).
 */

/**
 * XP that makes one course unit. Mirrors ally-be's `COURSE_UNIT_XP`
 * (course-units-analytics.repository.ts); the two are not wired together
 * (separate apps), so keep them in sync by hand if the definition ever moves.
 */
export const COURSE_UNIT_XP = 100;

/** One bucket of the course-units series. */
export interface CourseUnitsPoint {
  /** Bucket start (yyyy-mm-dd). */
  bucket: string;
  /** XP earned in the bucket / COURSE_UNIT_XP, two decimals. */
  units: number;
  /**
   * Target units for the period: the XP goal already configured for the
   * Utilization chart, / COURSE_UNIT_XP. Null when no goal is set (and always
   * at day/week grain) — never 0.
   */
  targetUnits: number | null;
  /** Distinct learners who earned XP in the bucket. */
  learners: number;
  /** units / learners; null (not 0) when nobody earned XP. */
  avgUnitsPerLearner: number | null;
}

export interface CourseUnitsResponse {
  window: AnalyticsWindow;
  unitXp: number;
  points: CourseUnitsPoint[];
  /** Always platform-wide — this chart has no tenant filter. */
  scoping: AnalyticsScoping;
  computedAt: string;
}

export interface CourseUnitsQuery {
  range?: AnalyticsRange;
  bucket?: AnalyticsBucket;
}

/** One series per panel; fixed colours so a filter never repaints them. */
export const COURSE_UNITS_COLORS = {
  units: PALETTE.blue,
  target: CONTEXT.strong,
  learners: PALETTE.teal,
  average: PALETTE.orange,
} as const;

/** Grains this chart offers — no `quarter`: the endpoint's window DTO has none. */
export type CourseUnitsGrain = Exclude<AnalyticsBucket, "quarter">;

/**
 * Window each grain reads. The chart is "units per period", so each grain
 * gets a span that keeps the axis legible: a month grain over a year is 12
 * bars, a day grain over a year would be 365.
 */
export const COURSE_UNITS_RANGE: Record<CourseUnitsGrain, AnalyticsRange> = {
  day: "30d",
  week: "90d",
  month: "12m",
  year: "all",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Short axis label for a bucket start. Months read "Oct", with the year added
 * on the first plotted bucket and on every January so a long axis stays
 * dateable; days and weeks read "31 Oct"; years read "2026".
 */
export const bucketAxisLabel = (
  bucket: string,
  grain: CourseUnitsGrain,
  isFirst: boolean,
): string => {
  const [y, m, d] = bucket.split("-").map(Number);
  const month = MONTHS[(m ?? 1) - 1];
  if (grain === "year") return String(y);
  if (grain === "month") return isFirst || m === 1 ? `${month} ${String(y).slice(2)}` : month;
  return `${d} ${month}`;
};

/** Whole numbers for big values, two decimals for fractions of a unit. */
export const formatUnits = (n: number): string =>
  n >= 100
    ? Math.round(n).toLocaleString()
    : n.toLocaleString(undefined, { maximumFractionDigits: n >= 10 ? 1 : 2 });

export const formatAverage = (n: number | null): string => (n === null ? "—" : n.toFixed(2));

/** The full axis, in-progress bucket included and flagged, for the detail table / export. */
export const buildCourseUnitsTable = (
  points: CourseUnitsPoint[],
  inProgressBucket?: string | null,
): { columns: string[]; rows: (string | number)[][] } => ({
  columns: ["Period", "Course units", "Target units", "Unique learners", "Avg units per learner"],
  rows: points.map(p => [
    p.bucket === inProgressBucket ? `${p.bucket} (in progress)` : p.bucket,
    p.units,
    p.targetUnits === null ? "No target set" : p.targetUnits,
    p.learners,
    p.avgUnitsPerLearner === null ? "—" : p.avgUnitsPerLearner,
  ]),
});

/** True only when nobody earned XP anywhere on the plotted axis. */
export const courseUnitsEmptyText = (points: CourseUnitsPoint[]): string | undefined =>
  points.length === 0 || points.every(p => p.learners === 0)
    ? "No learner has earned XP on this axis yet."
    : undefined;

/**
 * The one-sentence finding: the latest COMPLETE bucket. Never the in-progress
 * one — its figure can still rise, so quoting it would understate it.
 */
export const courseUnitsTakeaway = (
  points: CourseUnitsPoint[],
  inProgressBucket: string | null | undefined,
  grainNoun: string,
): string | undefined => {
  const latest = points.filter(p => p.bucket !== inProgressBucket).at(-1);
  if (!latest) return undefined;
  const vsTarget = latest.targetUnits
    ? ` (target ${formatUnits(latest.targetUnits)}, ${Math.round((latest.units / latest.targetUnits) * 100)}%)`
    : "";
  const avg =
    latest.avgUnitsPerLearner === null ? "" : `, ${formatAverage(latest.avgUnitsPerLearner)} each`;
  return (
    `${formatUnits(latest.units)} course units${vsTarget} from ${latest.learners.toLocaleString()} ` +
    `learners${avg}, in the latest complete ${grainNoun}`
  );
};
