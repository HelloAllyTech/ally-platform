import { AnalyticsWindowQuery } from "@api";
import { BugHuntTrigger, BugHunterOperationsDay, BugHunterOperationsMetrics } from "@types";

import { ColorScale, PALETTE } from "./chartScales";
import { formatUsd } from "./tokenChart";
import { formatRate } from "../BugHunter/scorecard";

/**
 * Pure transforms for the Bug Agent tab's two volume cards — what Bug Hunter
 * turns up day by day beside where each bug stands now, and what the runs
 * cost over time by what started them. Five sibling cards (by source,
 * difficulty, reporter, tokens by trigger, breadth, tokens by model) and
 * their transforms went on 2026-10-12 with the endpoint fields they read;
 * spend over time came back the same evening.
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

/* ── spend by trigger ────────────────────────────────────────────────── */

export const TRIGGER_ORDER: BugHuntTrigger[] = [
  BugHuntTrigger.SCHEDULED,
  BugHuntTrigger.MANUAL,
  BugHuntTrigger.FIX_SESSION,
  BugHuntTrigger.VERIFY_FIX,
  BugHuntTrigger.VERIFY_FINDINGS,
];

export const TRIGGER_LABELS: Record<BugHuntTrigger, string> = {
  [BugHuntTrigger.SCHEDULED]: "Nightly sweep",
  [BugHuntTrigger.MANUAL]: "On-demand sweep",
  [BugHuntTrigger.FIX_SESSION]: "Fix session",
  [BugHuntTrigger.VERIFY_FIX]: "Verifier (fixes)",
  [BugHuntTrigger.VERIFY_FINDINGS]: "Verifier (findings)",
  [BugHuntTrigger.PR_REVIEW]: "PR review",
  [BugHuntTrigger.FEATURE_MAP]: "Feature map",
};

export const TRIGGER_SCALE: ColorScale = {
  [TRIGGER_LABELS[BugHuntTrigger.SCHEDULED]]: PALETTE.blue,
  [TRIGGER_LABELS[BugHuntTrigger.MANUAL]]: PALETTE.orange,
  [TRIGGER_LABELS[BugHuntTrigger.FIX_SESSION]]: PALETTE.teal,
  [TRIGGER_LABELS[BugHuntTrigger.VERIFY_FIX]]: PALETTE.purple,
  [TRIGGER_LABELS[BugHuntTrigger.VERIFY_FINDINGS]]: PALETTE.magenta,
  [TRIGGER_LABELS[BugHuntTrigger.PR_REVIEW]]: PALETTE.green,
  [TRIGGER_LABELS[BugHuntTrigger.FEATURE_MAP]]: PALETTE.gold,
};

/* ── spend over time ─────────────────────────────────────────────────── */

/**
 * How finely the spend chart buckets time. Day is what the endpoint returns;
 * week and month are folded client-side from the same rows, so switching
 * costs no request and the three views always agree with each other.
 */
export type SpendGranularity = "day" | "week" | "month";

export const SPEND_GRANULARITIES: { id: SpendGranularity; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
];

/**
 * The bucket a UTC calendar day falls into. Weeks start on Monday and are
 * named by that Monday, so a bar is labelled by a date a reader can find on a
 * calendar rather than by an ISO week number; months are `YYYY-MM`.
 */
export const spendBucket = (date: string, granularity: SpendGranularity): string => {
  if (granularity === "day") return date;
  if (granularity === "month") return date.slice(0, 7);
  const d = new Date(`${date}T00:00:00Z`);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - sinceMonday);
  return `Wk of ${d.toISOString().slice(0, 10)}`;
};

const dayCost = (d: BugHunterOperationsDay, trigger: BugHuntTrigger): number =>
  d.tokens[trigger]?.costUsd ?? 0;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Buckets in the order the days arrived (ascending), each once. */
const spendBuckets = (days: BugHunterOperationsDay[], granularity: SpendGranularity): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  days.forEach(d => {
    const key = spendBucket(d.date, granularity);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  });
  return out;
};

/**
 * Estimated spend per bucket, stacked by what started the run. Uses the
 * CLI's own cost figure where a run reported one and our token-priced
 * estimate otherwise — the same number the shift log shows per run, summed.
 */
export const buildSpendSeries = (
  days: BugHunterOperationsDay[],
  granularity: SpendGranularity,
): OpsDatum[] => {
  const buckets = spendBuckets(days, granularity);
  return TRIGGER_ORDER.flatMap(trigger =>
    buckets.map(key => ({
      group: TRIGGER_LABELS[trigger],
      key,
      value: round2(
        days
          .filter(d => spendBucket(d.date, granularity) === key)
          .reduce((sum, d) => sum + dayCost(d, trigger), 0),
      ),
    })),
  );
};

export const buildSpendTable = (days: BugHunterOperationsDay[], granularity: SpendGranularity) => {
  const buckets = spendBuckets(days, granularity);
  const period =
    granularity === "day"
      ? "Day (UTC)"
      : granularity === "week"
        ? "Week (UTC, from Monday)"
        : "Month (UTC)";
  return {
    columns: [
      period,
      ...TRIGGER_ORDER.map(t => `${TRIGGER_LABELS[t]} (USD)`),
      "Total (USD)",
      "Runs",
    ],
    rows: buckets.map(key => {
      const inBucket = days.filter(d => spendBucket(d.date, granularity) === key);
      const perTrigger = TRIGGER_ORDER.map(t =>
        round2(inBucket.reduce((s, d) => s + dayCost(d, t), 0)),
      );
      const runs = inBucket.reduce(
        (s, d) => s + TRIGGER_ORDER.reduce((r, t) => r + (d.tokens[t]?.runs ?? 0), 0),
        0,
      );
      return [key, ...perTrigger, round2(perTrigger.reduce((s, v) => s + v, 0)), runs];
    }),
  };
};

const GRANULARITY_NOUN: Record<SpendGranularity, string> = {
  day: "day",
  week: "week",
  month: "month",
};

export const spendTakeaway = (
  data: BugHunterOperationsMetrics,
  granularity: SpendGranularity,
): string | undefined => {
  if (data.totals.costUsd === 0) return undefined;
  const series = buildSpendSeries(data.days, granularity);
  const totals = new Map<string, number>();
  series.forEach(p => totals.set(p.key, (totals.get(p.key) ?? 0) + p.value));
  const buckets = [...totals.entries()];
  if (buckets.length === 0) return undefined;
  const [peakKey, peak] = buckets.reduce((best, cur) => (cur[1] > best[1] ? cur : best));
  const average = data.totals.costUsd / buckets.length;
  return `${formatUsd(data.totals.costUsd)} over the window · ${formatUsd(average)} per ${GRANULARITY_NOUN[granularity]} on average · most in ${peakKey} (${formatUsd(peak)})`;
};

export const spendEmptyText = (data: BugHunterOperationsMetrics | undefined): string | undefined =>
  data && data.totals.costUsd === 0 ? "No runs spent anything in this window." : undefined;

/* ── empty states ─────────────────────────────────────────────────────── */

export const filedEmptyText = (data?: BugHunterOperationsMetrics): string | undefined =>
  !data || data.totals.filed === 0 ? "No bugs filed in this window yet." : undefined;
