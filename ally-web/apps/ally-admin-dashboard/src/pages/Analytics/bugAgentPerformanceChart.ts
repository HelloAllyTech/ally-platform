import {
  BugAgentPerformanceCostWeek,
  BugAgentPerformanceGoalWeek,
  BugAgentPerformanceGoalWindow,
  BugAgentPerformanceReliabilityWeek,
  BugAgentPerformanceSourceAccuracy,
  BugAgentPerformanceSpeedWeek,
  BugAgentPerformanceThroughputWeek,
} from "@types";

import { ColorScale, PALETTE } from "./chartScales";

export type WeeklyDatum = { group: string; key: string; value: number };

export type SourceAccuracyDatum = { group: string; value: number };

/** Whole-window accuracy by finder — bars, not a trend; sorted worst-first so the finder most worth attention leads. */
export function buildSourceAccuracyBreakdown(
  bySource: BugAgentPerformanceSourceAccuracy[],
): SourceAccuracyDatum[] {
  return bySource
    .filter(r => r.accuracy != null)
    .map(r => ({ group: r.source, value: r.accuracy as number }))
    .sort((a, b) => a.value - b.value);
}

const THROUGHPUT_GROUPS = {
  approvedToMerged: "Approved → merged",
  escalation: "Escalation rate",
  fallback: "Fallback rate",
};
export const THROUGHPUT_SCALE: ColorScale = {
  [THROUGHPUT_GROUPS.approvedToMerged]: PALETTE.green,
  [THROUGHPUT_GROUPS.escalation]: PALETTE.orange,
  [THROUGHPUT_GROUPS.fallback]: PALETTE.magenta,
};

export function buildThroughputTrend(weekly: BugAgentPerformanceThroughputWeek[]): WeeklyDatum[] {
  return weekly.flatMap(w => [
    ...(w.approvedToMergedRate == null
      ? []
      : [
          { group: THROUGHPUT_GROUPS.approvedToMerged, key: w.week, value: w.approvedToMergedRate },
        ]),
    ...(w.escalationRate == null
      ? []
      : [{ group: THROUGHPUT_GROUPS.escalation, key: w.week, value: w.escalationRate }]),
    ...(w.fallbackRate == null
      ? []
      : [{ group: THROUGHPUT_GROUPS.fallback, key: w.week, value: w.fallbackRate }]),
  ]);
}

const SPEED_GROUPS = {
  filedToDecided: "Filed → decided",
  filedToMerged: "Filed → merged",
  mergedToReleased: "Merged → released",
  queueToStart: "Queue → start",
};
export const SPEED_SCALE: ColorScale = {
  [SPEED_GROUPS.filedToDecided]: PALETTE.cyan,
  [SPEED_GROUPS.filedToMerged]: PALETTE.blue,
  [SPEED_GROUPS.mergedToReleased]: PALETTE.indigo,
  [SPEED_GROUPS.queueToStart]: PALETTE.teal,
};

/**
 * Four median-hour lines. `queueToStart` isolates runner/queue delay from
 * actual fix time — the other three, `filedToMerged` cannot distinguish on
 * its own.
 */
export function buildSpeedTrend(weekly: BugAgentPerformanceSpeedWeek[]): WeeklyDatum[] {
  return weekly.flatMap(w => [
    ...(w.filedToDecidedMedianHours == null
      ? []
      : [{ group: SPEED_GROUPS.filedToDecided, key: w.week, value: w.filedToDecidedMedianHours }]),
    ...(w.filedToMergedMedianHours == null
      ? []
      : [{ group: SPEED_GROUPS.filedToMerged, key: w.week, value: w.filedToMergedMedianHours }]),
    ...(w.mergedToReleasedMedianHours == null
      ? []
      : [
          {
            group: SPEED_GROUPS.mergedToReleased,
            key: w.week,
            value: w.mergedToReleasedMedianHours,
          },
        ]),
    ...(w.queueToStartMedianHours == null
      ? []
      : [{ group: SPEED_GROUPS.queueToStart, key: w.week, value: w.queueToStartMedianHours }]),
  ]);
}

const COST_GROUP = "Total spend (USD)";
export const COST_SCALE: ColorScale = { [COST_GROUP]: PALETTE.purple };

/** Total weekly spend is a real sum, never null — a quiet week is a real $0. */
export function buildCostTrend(weekly: BugAgentPerformanceCostWeek[]): WeeklyDatum[] {
  return weekly.map(w => ({ group: COST_GROUP, key: w.week, value: w.totalUsd }));
}

const RELIABILITY_GROUPS = {
  completion: "Completion rate",
  fallback: "Fallback rate",
  regression: "Regression rate",
};
export const RELIABILITY_SCALE: ColorScale = {
  [RELIABILITY_GROUPS.completion]: PALETTE.green,
  [RELIABILITY_GROUPS.fallback]: PALETTE.magenta,
  [RELIABILITY_GROUPS.regression]: PALETTE.darkRed,
};

export function buildReliabilityTrend(weekly: BugAgentPerformanceReliabilityWeek[]): WeeklyDatum[] {
  return weekly.flatMap(w => [
    ...(w.completionRate == null
      ? []
      : [{ group: RELIABILITY_GROUPS.completion, key: w.week, value: w.completionRate }]),
    ...(w.fallbackRate == null
      ? []
      : [{ group: RELIABILITY_GROUPS.fallback, key: w.week, value: w.fallbackRate }]),
    ...(w.regressionRate == null
      ? []
      : [{ group: RELIABILITY_GROUPS.regression, key: w.week, value: w.regressionRate }]),
  ]);
}

/* ── the goal: finding bugs before people do (OPP-0778) ─────────────────── */

export const GOAL_FIRST_FINDER_GROUP = "Found by Bug Hunter first";
export const GOAL_ESCAPE_GROUP = "Escaped a recent sweep";

export const GOAL_SCALE: ColorScale = {
  [GOAL_FIRST_FINDER_GROUP]: PALETTE.green,
  [GOAL_ESCAPE_GROUP]: PALETTE.red,
};

/** Two rates per week: the share of real bugs Bug Hunter found first, and the share of human reports that got past a sweep. Weeks with nothing to rate are left out of that line. */
export function buildGoalTrend(weekly: BugAgentPerformanceGoalWeek[]): WeeklyDatum[] {
  const out: WeeklyDatum[] = [];
  for (const w of weekly) {
    if (w.firstFinderShare != null)
      out.push({ group: GOAL_FIRST_FINDER_GROUP, key: w.week, value: w.firstFinderShare });
    if (w.escapeRate != null)
      out.push({ group: GOAL_ESCAPE_GROUP, key: w.week, value: w.escapeRate });
  }
  return out;
}

/** The miss reasons, in the words the drawer uses, worst first. */
export const MISS_REASON_LABELS: Record<string, string> = {
  no_sense: "No sense could see it",
  sense_missed: "A sense missed it",
  detected_declined: "Found, then turned down",
  detected_not_fixed: "Found, not fixed in time",
  not_a_miss: "Not a miss",
  unclassified: "Not classified yet",
};

export type MissReasonDatum = { group: string; value: number };

export function buildMissReasons(reasons: Record<string, number>): MissReasonDatum[] {
  return Object.entries(reasons)
    .filter(([, value]) => value > 0)
    .map(([reason, value]) => ({ group: MISS_REASON_LABELS[reason] ?? reason, value }))
    .sort((a, b) => b.value - a.value);
}

/** One sentence under the goal chart: the window's share, its escapes, and the median time to fix. */
export const goalTakeaway = (
  window: BugAgentPerformanceGoalWindow | undefined,
): string | undefined => {
  if (!window) return undefined;
  const total = window.agentBugs + window.humanReports;
  if (total === 0) return "No real bugs found by anyone in this window.";
  const share =
    window.firstFinderShare == null ? "—" : `${Math.round(window.firstFinderShare * 100)}%`;
  const fix =
    window.timeToFixHoursMedian == null
      ? "no fix merged yet"
      : window.timeToFixHoursMedian < 48
        ? `median ${Math.round(window.timeToFixHoursMedian)} h from filing to merge`
        : `median ${Math.round(window.timeToFixHoursMedian / 24)} days from filing to merge`;
  return `Bug Hunter found ${window.agentBugs} of ${total} real bugs first (${share}); people reported ${window.humanReports}, of which ${window.escapes} had slipped past a sweep in the week before; ${fix}.`;
};
