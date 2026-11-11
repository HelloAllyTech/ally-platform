import { en } from "@constants";
import { DebriefMetricsView, DebriefPassGroup, DebriefRate } from "@types";

/** Below this many in the denominator a rate is too few to read (matches ally-be). */
export const MIN_RATE_SAMPLE = 20;

export type TargetState = "met" | "missed" | "thin" | "no_data";
export interface Target {
  atLeast?: number;
  atMost?: number;
}

/** How a value stands against its v9 target. */
export const targetState = (value: number | null, target: Target, sample?: number): TargetState => {
  if (value == null) return "no_data";
  if (sample != null && sample < MIN_RATE_SAMPLE) return "thin";
  if (target.atLeast != null && value < target.atLeast) return "missed";
  if (target.atMost != null && value > target.atMost) return "missed";
  return "met";
};

/** 95% Wilson interval for a rate summed in the browser (same formula as ally-be's `wilson`). */
export const wilson = (n: number, of: number): { low: number | null; high: number | null } => {
  if (of <= 0) return { low: null, high: null };
  const z = 1.96;
  const p = n / of;
  const z2 = z * z;
  const centre = (p + z2 / (2 * of)) / (1 + z2 / of);
  const half = (z * Math.sqrt((p * (1 - p)) / of + z2 / (4 * of * of))) / (1 + z2 / of);
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
};

/** A rate's 95% range: the server's when it sent one, else Wilson on its counts. */
export const rangeOf = (r: DebriefRate): { low: number | null; high: number | null } =>
  r.low != null && r.high != null ? { low: r.low, high: r.high } : wilson(r.n, r.of);

/** Adds rates' counts: the whole window's total, with its range. */
export const sumRates = (rates: DebriefRate[]): DebriefRate => {
  const n = rates.reduce((a, r) => a + r.n, 0);
  const of = rates.reduce((a, r) => a + r.of, 0);
  return { n, of, value: of > 0 ? n / of : null, ...wilson(n, of) };
};

/** True when the rate counts something but too few to read. */
export const isThin = (r: DebriefRate | null | undefined): boolean =>
  !!r && r.of > 0 && r.of < MIN_RATE_SAMPLE;

/** "87.5%" — one decimal, dropped when whole. */
export const pctNum = (x: number) => `${Math.round(x * 1000) / 10}%`;

/** Live debriefs in the window: the weekly counts, or the pass-rate weeks when only those came. */
export const hasLiveDebriefs = (view: DebriefMetricsView): boolean =>
  view.series.some(w => w.debriefs > 0) ||
  (view.quality?.byWeek ?? []).some(w => w.passRate.of > 0 || w.outages > 0 || w.unjudged > 0);

/** Change in a weekly rate, last week vs the week before, in percentage points; null when either is thin. */
export const weekOnWeek = (rates: DebriefRate[]): number | null => {
  if (rates.length < 2) return null;
  const [prev, last] = rates.slice(-2);
  if (prev.value == null || last.value == null) return null;
  if (prev.of < MIN_RATE_SAMPLE || last.of < MIN_RATE_SAMPLE) return null;
  return (last.value - prev.value) * 100;
};

export interface HeadlineNumbers {
  pass: DebriefRate;
  hardFail: DebriefRate;
  judgeMean: number | null;
  judged: number;
  debriefs: number;
  outages: number;
  unjudged: number;
  spark: {
    pass: Array<number | null>;
    hardFail: Array<number | null>;
    judge: Array<number | null>;
    debriefs: number[];
    outages: number[];
    unjudged: number[];
  };
  delta: { pass: number | null; hardFail: number | null; judge: number | null };
}

/** The six headline numbers over the window, each with its weekly trend. */
export const headlineNumbers = (view: DebriefMetricsView): HeadlineNumbers => {
  const weeks = view.quality?.byWeek ?? [];
  const series = view.series;
  const pick = (f: (g: DebriefPassGroup) => DebriefRate) => sumRates(weeks.map(f));
  const judged = series.reduce((a, w) => a + w.guardrails.judged, 0);
  const judgeSum = series.reduce(
    (a, w) =>
      a + (w.guardrails.judgeMean == null ? 0 : w.guardrails.judgeMean * w.guardrails.judged),
    0,
  );
  const judgeWeeks = series.map(w => w.guardrails.judgeMean);
  const [prevJ, lastJ] = series.slice(-2);
  return {
    pass: pick(g => g.passRate),
    hardFail: pick(g => g.hardFailRate),
    judgeMean: judged > 0 ? judgeSum / judged : null,
    judged,
    debriefs: series.reduce((a, w) => a + w.debriefs, 0),
    outages: weeks.reduce((a, w) => a + w.outages, 0),
    unjudged: weeks.reduce((a, w) => a + w.unjudged, 0),
    spark: {
      pass: weeks.map(w => (w.passRate.value == null ? null : w.passRate.value * 100)),
      hardFail: weeks.map(w => (w.hardFailRate.value == null ? null : w.hardFailRate.value * 100)),
      judge: judgeWeeks,
      debriefs: series.map(w => w.debriefs),
      outages: weeks.map(w => w.outages),
      unjudged: weeks.map(w => w.unjudged),
    },
    delta: {
      pass: weekOnWeek(weeks.map(w => w.passRate)),
      hardFail: weekOnWeek(weeks.map(w => w.hardFailRate)),
      judge:
        prevJ &&
        lastJ &&
        prevJ.guardrails.judgeMean != null &&
        lastJ.guardrails.judgeMean != null &&
        prevJ.guardrails.judged >= MIN_RATE_SAMPLE &&
        lastJ.guardrails.judged >= MIN_RATE_SAMPLE
          ? lastJ.guardrails.judgeMean - prevJ.guardrails.judgeMean
          : null,
    },
  };
};

/** A Carbon bounded-line point: the line is `value`, the 95% band `min`..`max`, all in %. */
export interface BandPoint {
  group: string;
  key: string;
  value: number | null;
  min?: number;
  max?: number;
  n: number;
}

/** One weekly rate as a line with its 95% band, in percent. */
export const rateBand = (
  group: string,
  weeks: Array<{ week: string; rate: DebriefRate }>,
): BandPoint[] =>
  weeks.map(({ week, rate }) => {
    const ci = rangeOf(rate);
    return {
      group,
      key: week,
      value: rate.value == null ? null : Math.round(rate.value * 1000) / 10,
      ...(rate.value != null && ci.low != null && ci.high != null
        ? { min: Math.round(ci.low * 1000) / 10, max: Math.round(ci.high * 1000) / 10 }
        : {}),
      n: rate.of,
    };
  });

/** The smallest of a few round ceilings that holds every value: a zoomed-in axis for small rates. */
export const niceCeiling = (values: number[]): number => {
  const m = Math.max(0, ...values);
  return [0.05, 0.1, 0.2, 0.25, 0.5, 0.75, 1].find(c => m <= c) ?? 1;
};

/** "87% (95% range 80–92%, 104 of 120)", or "—" with nothing counted. */
export const rateWithRange = (r: DebriefRate | null | undefined): string => {
  const s = en.debriefs.metrics.quality;
  if (!r || r.value == null) return en.debriefs.metrics.none;
  const ci = rangeOf(r);
  const range = ci.low != null && ci.high != null ? s.range(pctNum(ci.low), pctNum(ci.high)) : "";
  return `${pctNum(r.value)} (${[range, s.of(r.n, r.of)].filter(Boolean).join(", ")})`;
};
