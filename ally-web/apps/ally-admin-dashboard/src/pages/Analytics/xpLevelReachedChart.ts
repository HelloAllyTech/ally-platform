import { AnalyticsRange, AnalyticsScoping, AnalyticsWindow } from "@types";

import { ColorScale, sequentialScale } from "./chartScales";

/**
 * `day`/`week`/`month`/`quarter`/`year` — wider than the shared
 * `AnalyticsBucket` (day/week/month/year only), because this endpoint alone
 * accepts `quarter` (see ally-be's `XP_LEVEL_REACHED_BUCKETS`, declared
 * locally there for the same reason: the shared bucket type several other
 * charts depend on staying at its current four values). Declared here rather
 * than imported, matching the "wire types live beside their transforms"
 * choice above.
 */
export type XpLevelReachedBucket = "day" | "week" | "month" | "quarter" | "year";

/**
 * Pure transforms + wire types for the Goals -> "New levels reached" card.
 *
 * The response/query shapes are declared here rather than in `@types`
 * (types/auth.ts): that file is mid-edit by a concurrent session during this
 * groundwork pass, so the new analytics wire types live beside the transforms
 * that consume them instead of adding to it. Mirrors ally-be's
 * `XpLevelReachedResponseDto` (src/analytics/dto/xp-level-reached-analytics.dto.ts).
 */

/**
 * Mirrors ally-be's `MAX_LEVEL` (src/progress/progress.constants.ts) — every
 * level from 1 through this is always present in a bucket's `levelCounts`,
 * whether or not anyone crossed it that period. Level 0 is the starting state
 * every account has, so it is never charted. The two constants are not wired
 * together (separate repos); keep them in sync by hand if the ladder ever
 * grows.
 */
export const XP_LEVEL_REACHED_MAX_LEVEL = 50;

/** Levels plotted at once: fifty grouped series in one chart is unreadable. */
export const XP_LEVEL_RANGE_SIZE = 10;

export interface XpLevelRange {
  key: string;
  label: string;
  /** First and last level plotted, inclusive. */
  from: number;
  to: number;
}

/** The picker's choices — L1-L10, L11-L20, … through the top of the ladder. */
export const xpLevelRanges = (maxLevel = XP_LEVEL_REACHED_MAX_LEVEL): XpLevelRange[] =>
  Array.from({ length: Math.ceil(maxLevel / XP_LEVEL_RANGE_SIZE) }, (_, i) => {
    const from = i * XP_LEVEL_RANGE_SIZE + 1;
    const to = Math.min(maxLevel, from + XP_LEVEL_RANGE_SIZE - 1);
    return { key: `${from}-${to}`, label: `L${from}–L${to}`, from, to };
  });

/** Every point restricted to the levels in `range`, buckets untouched. */
export const pointsInLevelRange = (
  points: XpLevelReachedPoint[],
  range: XpLevelRange,
): XpLevelReachedPoint[] =>
  points.map(p => ({
    ...p,
    levelCounts: p.levelCounts.filter(lc => lc.level >= range.from && lc.level <= range.to),
  }));

/** One level's crossing count within one bucket. */
export interface XpLevelReachedLevelCount {
  /** 1-indexed level number. */
  level: number;
  /** Learners who FIRST reached this level during this bucket. */
  users: number;
}

/** One bucket of the level-attainment series. */
export interface XpLevelReachedPoint {
  /** Bucket start (yyyy-mm-dd). */
  bucket: string;
  /** Every level 1 through {@link XP_LEVEL_REACHED_MAX_LEVEL}, ascending,
   *  whether or not anyone crossed it this bucket. */
  levelCounts: XpLevelReachedLevelCount[];
}

export interface XpLevelReachedResponse {
  window: AnalyticsWindow;
  points: XpLevelReachedPoint[];
  /** Always platform-wide — this chart has no tenant filter. */
  scoping: AnalyticsScoping;
  computedAt: string;
}

/** No `tenantId`, no `compare`: platform-wide only (see the backend query
 *  DTO's own doc comment). `bucket` accepts the same day/week/month/quarter/
 *  year vocabulary as every other bucketed chart — the ladder's own sparse-
 *  top-levels problem is a reason to read coarser, not a reason for a
 *  different vocabulary. */
export interface XpLevelReachedQuery {
  range?: AnalyticsRange;
  bucket?: XpLevelReachedBucket;
  from?: string;
  to?: string;
}

export const levelLabel = (level: number): string => `L${level}`;

/**
 * One hue per level, low -> high saturation (§8.3 ordered categories): the
 * ladder is an ORDER, not an unordered set of names, so a rainbow categorical
 * palette would invent a ranking the data already carries.
 */
export const xpLevelReachedScale = (levels: number[]): ColorScale =>
  sequentialScale(levels.map(levelLabel));

export interface XpLevelReachedDatum {
  group: string;
  key: string;
  value: number;
}

/**
 * Grouped-bar series, one datum per (level, bucket) — NESTED, never stacked
 * (a learner who crosses several levels in one bucket counts once in each,
 * so summing them into one bar would double-count people). Every level
 * present in `levelCounts` gets a datum even at 0: the upper levels reading
 * zero everywhere is expected on a platform whose ladder is known to be
 * mis-scaled today (most learners sit at L0-L1 — see the backend DTO doc),
 * not missing data, so nothing here filters a level out for being quiet.
 */
export const buildXpLevelReachedSeries = (points: XpLevelReachedPoint[]): XpLevelReachedDatum[] =>
  points.flatMap(p =>
    p.levelCounts.map(lc => ({ group: levelLabel(lc.level), key: p.bucket, value: lc.users })),
  );

/** The full, unfiltered axis — including the in-progress bucket, flagged —
 *  for the detail table and the export. */
export const buildXpLevelReachedTable = (
  points: XpLevelReachedPoint[],
  inProgressBucket?: string | null,
): { columns: string[]; rows: (string | number)[][] } => {
  const levels = points[0]?.levelCounts.map(lc => lc.level) ?? [];
  return {
    columns: ["Period", ...levels.map(levelLabel)],
    rows: points.map(p => [
      p.bucket === inProgressBucket ? `${p.bucket} (in progress)` : p.bucket,
      ...p.levelCounts.map(lc => lc.users),
    ]),
  };
};

/**
 * True only when NOTHING crossed any plotted level anywhere on the axis.
 * Judging "empty" per level would misreport an ordinary window as broken: an
 * all-zero upper tail beside a busy L1 is the expected shape of today's
 * population, not a gap. `scopeLabel` names the level range being shown, so
 * an empty range reads as "nothing in L11–L20", not "no one has levelled up".
 */
export const xpLevelReachedEmptyText = (
  points: XpLevelReachedPoint[],
  scopeLabel?: string,
): string | undefined => {
  const total = points.reduce(
    (sum, p) => sum + p.levelCounts.reduce((s, lc) => s + lc.users, 0),
    0,
  );
  if (total !== 0) return undefined;
  return scopeLabel
    ? `No learner has reached a level in ${scopeLabel} in this window yet.`
    : "No learner has reached a new XP level in this window yet.";
};

/**
 * The one-sentence finding: total crossings in the latest COMPLETE bucket,
 * and L1's share of them — named explicitly because L1 dominates the
 * ladder today, so a reader should not have to discover that fact from a
 * chart that is mostly one tall bar and a row of short ones.
 */
export const xpLevelReachedTakeaway = (
  points: XpLevelReachedPoint[],
  inProgressBucket: string | null | undefined,
  grainNoun: string,
): string | undefined => {
  const complete = points.filter(p => p.bucket !== inProgressBucket);
  const latest = complete.at(-1);
  if (!latest) return undefined;

  const total = latest.levelCounts.reduce((s, lc) => s + lc.users, 0);
  if (total === 0) return `No learner reached a new level in the latest complete ${grainNoun}`;

  const l1 = latest.levelCounts.find(lc => lc.level === 1)?.users ?? 0;
  const l1Share = Math.round((l1 / total) * 100);
  return (
    `${total.toLocaleString()} new level crossings in the latest complete ${grainNoun} — ` +
    `${l1Share}% of them into L1`
  );
};
