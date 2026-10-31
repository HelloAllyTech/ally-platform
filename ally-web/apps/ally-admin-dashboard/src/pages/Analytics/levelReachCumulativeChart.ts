import { PALETTE } from "./chartScales";
import { XpLevelReachedPoint, levelLabel } from "./xpLevelReachedChart";

/**
 * Pure transforms for Goals → "Learners who have reached level N" (AAQ-253).
 *
 * Fed by the same `xp-level-reached` response as AAQ-007, read all-time at monthly
 * grain: that endpoint reports learners who FIRST crossed each level in a month, so
 * the running sum of one level's counts is the number of unique learners who have
 * ever reached it. No new endpoint is needed.
 */

/** Levels offered by the picker. */
export const LEVEL_REACH_LEVELS = [1, 2, 3, 4, 5] as const;
export const DEFAULT_LEVEL_REACH_LEVEL = 1;

export const LEVEL_REACH_NET_GROUP = "Net added in month";
export const LEVEL_REACH_CUMULATIVE_GROUP = "Cumulative learners";

export const levelReachScale = {
  [LEVEL_REACH_NET_GROUP]: PALETTE.cyan,
  [LEVEL_REACH_CUMULATIVE_GROUP]: PALETTE.blue,
};

export interface LevelReachRow {
  /** Month start (yyyy-mm-dd). */
  bucket: string;
  /** Learners who first reached the level this month: the net addition over last month. */
  added: number;
  /** Unique learners who have reached the level by the end of this month. */
  cumulative: number;
}

/**
 * One row per month for `level`, running total carried across the WHOLE axis.
 * The total is accumulated before anything is dropped, so leaving the in-progress
 * month off the plot never changes the earlier months' numbers.
 */
export const buildLevelReachRows = (
  points: XpLevelReachedPoint[],
  level: number,
): LevelReachRow[] => {
  let running = 0;
  return points.map(p => {
    const added = p.levelCounts.find(lc => lc.level === level)?.users ?? 0;
    running += added;
    return { bucket: p.bucket, added, cumulative: running };
  });
};

export interface LevelReachDatum {
  group: string;
  key: string;
  value: number;
}

/** Combo-chart data: bars for the monthly addition, line for the running total. */
export const buildLevelReachSeries = (rows: LevelReachRow[]): LevelReachDatum[] =>
  rows.flatMap(r => [
    { group: LEVEL_REACH_NET_GROUP, key: r.bucket, value: r.added },
    { group: LEVEL_REACH_CUMULATIVE_GROUP, key: r.bucket, value: r.cumulative },
  ]);

/** Full axis for the detail table and export, the accruing month flagged. */
export const buildLevelReachTable = (
  rows: LevelReachRow[],
  level: number,
  inProgressBucket?: string | null,
): { columns: string[]; rows: (string | number)[][] } => ({
  columns: ["Month", `New ${levelLabel(level)} this month`, `Cumulative ${levelLabel(level)}`],
  rows: rows.map(r => [
    r.bucket === inProgressBucket ? `${r.bucket} (in progress)` : r.bucket,
    r.added,
    r.cumulative,
  ]),
});

/** Empty only when nobody has reached the level yet, across the whole history. */
export const levelReachEmptyText = (rows: LevelReachRow[], level: number): string | undefined =>
  (rows.at(-1)?.cumulative ?? 0) === 0
    ? `No learner has reached ${levelLabel(level)} yet.`
    : undefined;

/** The finding: the total, and how it moved in the latest complete month. */
export const levelReachTakeaway = (
  rows: LevelReachRow[],
  level: number,
  inProgressBucket?: string | null,
): string | undefined => {
  const complete = rows.filter(r => r.bucket !== inProgressBucket);
  const latest = complete.at(-1);
  if (!latest) return undefined;
  const label = levelLabel(level);
  const change = latest.added === 0 ? "none added" : `${latest.added.toLocaleString()} added`;
  return (
    `${latest.cumulative.toLocaleString()} learners have reached ${label} as of ` +
    `${latest.bucket.slice(0, 7)} — ${change} that month`
  );
};
