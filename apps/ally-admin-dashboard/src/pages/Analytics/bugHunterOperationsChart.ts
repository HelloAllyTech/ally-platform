import { AnalyticsWindowQuery } from "@api";
import { BugHunterOperationsDay, BugHunterOperationsMetrics } from "@types";

import { ColorScale, PALETTE } from "./chartScales";
import { formatRate } from "../BugHunter/scorecard";

/**
 * Pure transforms for the Bug Agent tab's one volume card — what Bug Hunter
 * turns up day by day, beside where each bug stands now. Six sibling cards
 * (by source, difficulty, reporter, tokens, spend, breadth, model) and their
 * transforms went on 2026-10-12 with the endpoint fields they read.
 *
 * Fed by `GET /v1/bug-hunter/metrics/operations`, which returns every
 * calendar day in the window (dense, zeros included) with each day's filed
 * count already paired with where that cohort stands now. The rule these
 * builders keep is the endpoint's own: a volume figure is never drawn
 * without its acceptance share beside it, because a bar of "12 filed" on its
 * own rewards a noisy finder exactly as much as a good one.
 *
 * ## Colour follows the entity
 *
 * Every scale here is a fixed lookup keyed by the enum, never an index into
 * the current response. A source that files nothing for a month keeps its
 * colour when it returns, and narrowing the range never repaints the
 * survivors — the same reason `chartScales.stableScale` exists, applied to
 * dimensions small enough to pin by hand.
 */

/** The endpoint's own ceiling on `days` (BUG_HUNTER_METRICS_MAX_DAYS). */
export const OPERATIONS_MAX_DAYS = 365;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The page-level range, as the day count the operations endpoint takes.
 *
 * That endpoint is anchored on "now" and windows backwards, so a custom
 * from→to pair becomes "from `from` until today" — the honest reading of the
 * one shape it cannot express — and "all" becomes the endpoint's own maximum.
 * Both are said on the card rather than hidden.
 */
export const rangeToDays = (query: AnalyticsWindowQuery, now: Date = new Date()): number => {
  if (query.from && query.to) {
    const from = new Date(query.from).getTime();
    if (!Number.isNaN(from)) {
      const days = Math.ceil((now.getTime() - from) / MS_PER_DAY);
      return Math.min(OPERATIONS_MAX_DAYS, Math.max(1, days));
    }
  }
  switch (query.range) {
    case "90d":
      return 90;
    case "12m":
    case "all":
      return OPERATIONS_MAX_DAYS;
    case "30d":
    default:
      return 30;
  }
};

/** What the window actually covered, for the provenance line. */
export const operationsWindowLabel = (data?: BugHunterOperationsMetrics): string =>
  data
    ? `last ${data.windowDays} days (${data.since.slice(0, 10)} → today, UTC days)`
    : "window loading";

export interface OpsDatum {
  group: string;
  key: string;
  value: number;
}

/* ── outcomes ─────────────────────────────────────────────────────────── */

export const OUTCOME_ACCEPTED = "Accepted";
export const OUTCOME_DECLINED = "Declined";
export const OUTCOME_UNDECIDED = "Undecided";

/**
 * Green for accepted matches THROUGHPUT_SCALE's "approved → merged" on the
 * sibling cards, so "good news" is one hue across the tab. Undecided is grey
 * because it is the absence of a decision, not a third outcome.
 */
export const OUTCOME_SCALE: ColorScale = {
  [OUTCOME_ACCEPTED]: PALETTE.green,
  [OUTCOME_DECLINED]: PALETTE.orange,
  [OUTCOME_UNDECIDED]: PALETTE.gray,
};

export const buildFiledSeries = (days: BugHunterOperationsDay[]): OpsDatum[] => [
  ...days.map(d => ({ group: OUTCOME_ACCEPTED, key: d.date, value: d.accepted })),
  ...days.map(d => ({ group: OUTCOME_DECLINED, key: d.date, value: d.declined })),
  ...days.map(d => ({ group: OUTCOME_UNDECIDED, key: d.date, value: d.undecided })),
];

export const buildFiledTable = (days: BugHunterOperationsDay[]) => ({
  columns: ["Day (UTC)", OUTCOME_ACCEPTED, OUTCOME_DECLINED, OUTCOME_UNDECIDED, "Filed"],
  rows: days.map(d => [d.date, d.accepted, d.declined, d.undecided, d.filed]),
});

/** "N filed · X% of those ruled on accepted", or the honest sentence when nothing has been ruled on. */
export const filedTakeaway = (data: BugHunterOperationsMetrics): string | undefined => {
  const { filed, accepted, declined } = data.totals;
  if (filed === 0) return undefined;
  const judged = accepted + declined;
  if (judged === 0) return `${filed.toLocaleString()} filed — none ruled on yet`;
  return `${filed.toLocaleString()} filed · ${formatRate(accepted / judged)} of the ${judged.toLocaleString()} ruled on were accepted`;
};

/* ── empty states ─────────────────────────────────────────────────────── */

export const filedEmptyText = (data?: BugHunterOperationsMetrics): string | undefined =>
  !data || data.totals.filed === 0 ? "No bugs filed in this window yet." : undefined;
