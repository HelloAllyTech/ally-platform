import { PmBetterWhen, PmMetricUnit, PmMetricWindow } from './metric-catalog';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Tunables for impact checks (docs/pm-agent.md "Implementation notes (impact checks)"). */
export const PM_IMPACT = {
  /** Every read (baseline and checks) covers this many whole UTC days. */
  WINDOW_DAYS: 14,
  /** The two checks after release. */
  CHECK_DAYS: [14, 30] as const,
  /** |relative change| below this is `flat`. */
  MIN_RELATIVE_CHANGE: 0.03,
  /** Failed reads are retried on later daily ticks; this many failures is terminal. */
  MAX_ATTEMPTS: 3,
  /** Advisory lock of the daily due-reads job: (1982000, 5). 1–3 are taken; 4 is left free. */
  LOCK_NAMESPACE: 1982000,
  LOCK_KEY: 5,
  /** Daily at 04:00 IST (with `timeZone: CRON_TZ`). */
  CRON: '0 0 4 * * *',
  CRON_TZ: 'Asia/Kolkata',
  /** Rows per daily tick (each read is a handful of bounded aggregate queries). */
  BATCH: 200,
} as const;

export type PmImpactRowStatus =
  | 'pending'
  | 'measured'
  | 'insufficient_data'
  | 'unavailable'
  | 'not_measurable';
export type PmImpactVerdict = 'improved' | 'flat' | 'worse';

const utcDay = (date: Date) =>
  new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * DAY_MS);

/**
 * The windows for one release. R = the release's UTC calendar day.
 *  - baseline (day 0): the 14 whole days BEFORE R  → [R−14, R−1], due at release;
 *  - check +d: the 14 whole days ending on R+d     → [R+d−13, R+d], due at the start of R+d+1
 *    (the window's last day is complete). +14 therefore starts the day after release, so the
 *    release day itself (half old, half new) is in no window.
 */
export function impactSchedule(releasedAt: Date): {
  day: 0 | 14 | 30;
  window: PmMetricWindow;
  dueAt: Date;
}[] {
  const r = utcDay(releasedAt);
  const span = PM_IMPACT.WINDOW_DAYS;
  return [
    {
      day: 0 as const,
      window: {
        from: isoDay(addDays(r, -span)),
        to: isoDay(addDays(r, -1)),
      },
      dueAt: releasedAt,
    },
    ...PM_IMPACT.CHECK_DAYS.map((day) => ({
      day,
      window: {
        from: isoDay(addDays(r, day - span + 1)),
        to: isoDay(addDays(r, day)),
      },
      dueAt: addDays(r, day + 1),
    })),
  ];
}

/**
 * Verdict of one read against the baseline. `insufficient_data` when either side has no
 * value or stands on fewer than `minSample` units; otherwise improved / flat / worse by
 * `betterWhen` and the minimum relative change (strictly below = flat; exactly at it counts).
 * A zero baseline: any move is a change in its direction (relative change is undefined).
 */
export function impactVerdict(input: {
  baseline: number | null | undefined;
  baselineSample: number | null | undefined;
  value: number | null | undefined;
  sample: number | null | undefined;
  minSample: number;
  betterWhen: PmBetterWhen;
  minRelativeChange?: number;
}):
  | { status: 'measured'; verdict: PmImpactVerdict; relativeChange: number }
  | { status: 'insufficient_data' } {
  const {
    baseline,
    value,
    minSample,
    betterWhen,
    minRelativeChange = PM_IMPACT.MIN_RELATIVE_CHANGE,
  } = input;
  if (
    baseline == null ||
    value == null ||
    !Number.isFinite(baseline) ||
    !Number.isFinite(value) ||
    (input.baselineSample ?? 0) < minSample ||
    (input.sample ?? 0) < minSample
  ) {
    return { status: 'insufficient_data' };
  }
  const delta = value - baseline;
  const relativeChange =
    baseline === 0
      ? delta === 0
        ? 0
        : Math.sign(delta) * Infinity
      : delta / Math.abs(baseline);
  // Round away float noise so a change of exactly 3% is not judged on 0.0299999.
  const magnitude = Math.round(Math.abs(relativeChange) * 1e9) / 1e9;
  if (magnitude < minRelativeChange) {
    return { status: 'measured', verdict: 'flat', relativeChange };
  }
  const better = betterWhen === 'up' ? delta > 0 : delta < 0;
  return {
    status: 'measured',
    verdict: better ? 'improved' : 'worse',
    relativeChange,
  };
}

const trim = (value: number, digits: number) =>
  Number(value.toFixed(digits)).toLocaleString('en-US', {
    maximumFractionDigits: digits,
  });

/** A metric value for people: 38%, 1,204, 950 ms, $0.0123, 4.12. */
export function formatMetricValue(
  value: number,
  unit: PmMetricUnit | undefined,
): string {
  switch (unit) {
    case 'percent':
      return `${trim(value, 1)}%`;
    case 'count':
      return trim(value, 0);
    case 'ms':
      return `${trim(value, 0)} ms`;
    case 'usd':
      return Math.abs(value) < 1
        ? `$${value.toFixed(4)}`
        : `$${trim(value, 2)}`;
    default:
      return trim(value, 2);
  }
}

/**
 * The plain-text line on a card: "Next-day return: 38% to 44% (improved)". From the latest
 * read check that has a value; undefined until then (or without a baseline).
 */
export function impactSummary(input: {
  metricName: string;
  unit?: PmMetricUnit;
  baseline?: number | null;
  checks: {
    day: number;
    status: string;
    value?: number | null;
    verdict?: PmImpactVerdict | null;
  }[];
}): string | undefined {
  if (input.baseline == null) return undefined;
  const latest = [...input.checks]
    .filter(
      (check) =>
        check.value != null &&
        (check.status === 'measured' || check.status === 'insufficient_data'),
    )
    .sort((a, b) => b.day - a.day)[0];
  if (!latest || latest.value == null) return undefined;
  const outcome =
    latest.status === 'measured' && latest.verdict
      ? latest.verdict
      : 'not enough data';
  return `${input.metricName}: ${formatMetricValue(input.baseline, input.unit)} to ${formatMetricValue(
    latest.value,
    input.unit,
  )} (${outcome})`;
}
