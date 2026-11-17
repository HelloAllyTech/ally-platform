import type { RoadmapMetrics, RoadmapMetricsQuery } from "@types";

/** The Measures view's range presets, in days. 30 is the default (P8). */
export const MEASURE_RANGES = ["7", "30", "90", "365"] as const;
export type MeasureRange = (typeof MEASURE_RANGES)[number];
export const DEFAULT_MEASURE_RANGE: MeasureRange = "30";

const DAY_MS = 86_400_000;

export const measureRangeOf = (value: string | null | undefined): MeasureRange =>
  (MEASURE_RANGES as readonly string[]).includes(value ?? "")
    ? (value as MeasureRange)
    : DEFAULT_MEASURE_RANGE;

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * The last `days` days, today included, as UTC dates. Date-only on purpose: the query is the same
 * all day, so the cached answer is reused rather than refetched on every render.
 */
export const queryForRange = (
  range: MeasureRange,
  now: number = Date.now(),
): RoadmapMetricsQuery => {
  const days = Number(range);
  return { from: isoDay(now - (days - 1) * DAY_MS), to: isoDay(now) };
};

/** A duration in the unit a person reads it in: seconds, minutes, hours, then days. */
export const formatDuration = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "";
  const seconds = ms / 1000;
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h`;
  const days = hours / 24;
  return `${days < 10 ? days.toFixed(1) : Math.round(days)} d`;
};

/** Whole percent of `of`, 0 when there is nothing to divide by. */
export const percentOf = (n: number, of: number): number =>
  of > 0 ? Math.round((n / of) * 100) : 0;

/**
 * The amber line in calendar time, for drawing it beside calendar-time waits: N working days is
 * about N × 7/5 days. The count past amber comes from the server, which counts working days exactly.
 */
export const amberLineMs = (workingDays: number): number => (workingDays * 7 * DAY_MS) / 5;

/** Nothing happened in the range and nothing is waiting: the view shows its empty state. */
export const measuresEmpty = (m: RoadmapMetrics): boolean =>
  m.funnel.captured === 0 &&
  m.funnel.filedWithoutDraft === 0 &&
  m.stages.every(s => s.n === 0) &&
  m.reviewWait.n === 0 &&
  m.reviewWait.waitingNow === 0 &&
  m.releases.held.total === 0 &&
  m.releases.failed.total === 0 &&
  m.releases.failingIdeasNow === 0 &&
  m.spend.ideas === 0;
