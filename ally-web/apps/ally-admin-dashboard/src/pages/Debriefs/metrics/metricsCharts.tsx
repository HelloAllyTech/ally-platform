import React, { ReactNode, useState } from "react";

import { en } from "@constants";
import { DebriefRate } from "@types";

import { MIN_RATE_SAMPLE, TargetState, isThin, niceCeiling, pctNum, rangeOf } from "./metricsData";
import { CONTEXT, PALETTE } from "../../Analytics/chartScales";

/*
 * Plain-HTML interval charts for the Debriefs tab, built the way ChangeWhiskers
 * and CourseLiftWhiskers are: full-length labels in a left column, the mark on a
 * shared axis, the numbers in words on the right so nothing rests on colour or
 * hover. Colours come from the analytics palette only: one hue for the subject,
 * grey for context and for samples too small to read, green/red only where a
 * target gives them a meaning.
 */

const GRID =
  "grid grid-cols-1 gap-1 sm:grid-cols-[minmax(9rem,16rem)_1fr_minmax(11rem,15rem)] sm:gap-3";

/** Narrow cards: the label on its own line, then the mark beside its numbers. */
const COMPACT = "grid grid-cols-[1fr_minmax(8rem,10.5rem)] gap-x-3";

/** Where `v` sits on a 0..max axis, as a CSS percentage. */
const at = (v: number, max: number) => `${(Math.max(0, Math.min(max, v)) / max) * 100}%`;

/** Axis ends and middle, in percent. */
const PctAxis: React.FC<{ max: number; label?: string; compact?: boolean }> = ({
  max,
  label,
  compact,
}) => (
  <div className={`${compact ? COMPACT : GRID} mb-1 text-xs text-typography-500`}>
    {!compact && <span className="hidden sm:block" />}
    <span className="flex justify-between tabular-nums">
      <span>0%</span>
      <span>{pctNum(max / 2)}</span>
      <span>{pctNum(max)}</span>
    </span>
    <span className={compact ? "" : "hidden sm:block"}>
      {label ?? en.debriefs.metrics.charts.rateAxis}
    </span>
  </div>
);

/** One rate as a dot with its 95% whisker on a 0..max axis. */
const RateMark: React.FC<{ rate: DebriefRate; max: number; color: string; thin: boolean }> = ({
  rate,
  max,
  color,
  thin,
}) => {
  if (rate.value == null) return null;
  const ci = rangeOf(rate);
  return (
    <>
      {ci.low != null && ci.high != null && (
        <span
          className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded"
          style={{
            left: at(ci.low, max),
            width: `calc(${at(ci.high, max)} - ${at(ci.low, max)})`,
            background: color,
            opacity: thin ? 0.6 : 1,
          }}
        />
      )}
      <span
        className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
        style={{
          left: at(rate.value, max),
          // Hollow for a sample too small to read; solid with a surface ring otherwise.
          background: thin ? "var(--cds-layer-01, white)" : color,
          borderColor: thin ? color : "var(--cds-layer-01, white)",
        }}
      />
    </>
  );
};

export interface RateRow {
  key: string;
  label: ReactNode;
  sublabel?: ReactNode;
  rate: DebriefRate;
  /** Extra words after "n of m", e.g. hard-fail rate and judge score. */
  extra?: string;
  /** Overrides the dot colour (e.g. a status colour against a target). */
  color?: string;
}

/** "80% [63–90%] · 24 of 30", or "too few to read" words for a thin sample. */
export const rateWords = (r: DebriefRate): ReactNode => {
  const s = en.debriefs.metrics;
  if (r.value == null) return <span className="text-typography-500">{s.charts.noneCounted}</span>;
  const ci = rangeOf(r);
  return (
    <>
      {pctNum(r.value)}{" "}
      {ci.low != null && ci.high != null && (
        <span className="text-typography-500">
          [{pctNum(ci.low)}–{pctNum(ci.high)}]
        </span>
      )}{" "}
      · {s.count(r.n, r.of)}
      {isThin(r) && (
        <span className="ml-1 text-typography-500" data-thin="true">
          · {s.states.thin.toLowerCase()}
        </span>
      )}
    </>
  );
};

/**
 * Horizontal dot-and-whisker chart of rates: one row per group, each with its
 * 95% range and its count, on one shared axis. Groups with fewer than
 * {@link MIN_RATE_SAMPLE} counted are drawn hollow and grey and say "too few to
 * read". With `top`, only the `top` largest groups show until "Show all".
 */
export const RateDots: React.FC<{
  rows: RateRow[];
  /** Sort by value, highest first (thin and empty rows last). Off for ordered groups. */
  sort?: boolean;
  /** Show only the `top` groups with the most counted, until the reader asks for all. */
  top?: number;
  /** Axis maximum (0..1); defaults to the smallest round ceiling that holds every range. */
  max?: number;
  /** A target drawn as a vertical rule across every row. */
  target?: number;
  axisLabel?: string;
  color?: string;
  /** Label above the mark, for narrow cards. */
  compact?: boolean;
  /** Show the "hollow dot means too few" line (off when the section states it once). */
  legend?: boolean;
  testId?: string;
}> = ({
  rows,
  sort = true,
  top,
  max,
  target,
  axisLabel,
  color = PALETTE.blue,
  compact = false,
  legend = true,
  testId,
}) => {
  const s = en.debriefs.metrics.charts;
  const [all, setAll] = useState(false);
  const limited =
    top && !all && rows.length > top
      ? [...rows].sort((a, b) => b.rate.of - a.rate.of).slice(0, top)
      : rows;
  const shown = sort
    ? [...limited].sort((a, b) => {
        const rank = (r: RateRow) => (r.rate.value == null ? 2 : isThin(r.rate) ? 1 : 0);
        return rank(a) - rank(b) || (b.rate.value ?? 0) - (a.rate.value ?? 0);
      })
    : limited;
  const axisMax =
    max ??
    niceCeiling([
      // A thin group's wide range would squash every readable row; it clamps at the edge instead.
      ...(rows.some(r => !isThin(r.rate)) ? rows.filter(r => !isThin(r.rate)) : rows).map(
        r => rangeOf(r.rate).high ?? r.rate.value ?? 0,
      ),
      ...(target != null ? [target] : []),
    ]);
  return (
    <div className="flex flex-col" data-testid={testId}>
      <PctAxis max={axisMax} label={axisLabel} compact={compact} />
      {shown.map(r => {
        const thin = isThin(r.rate);
        const c = thin || r.rate.value == null ? CONTEXT.line : (r.color ?? color);
        return (
          <div
            key={r.key}
            className={`${compact ? COMPACT : GRID} items-center border-t border-gray-100 py-1.5`}
            data-testid={testId ? `${testId}-row` : undefined}
            data-thin={thin ? "true" : undefined}
          >
            <span className={`flex min-w-0 flex-col ${compact ? "col-span-2" : ""}`}>
              <span className="break-words text-xs text-typography-900">{r.label}</span>
              {r.sublabel && (
                <span className="break-words text-xs text-typography-500">{r.sublabel}</span>
              )}
            </span>
            <span className="relative h-5" aria-hidden>
              {target != null && (
                <span
                  className="absolute top-0 h-full w-0.5"
                  style={{ left: at(target, axisMax), background: CONTEXT.strong }}
                />
              )}
              <RateMark rate={r.rate} max={axisMax} color={c} thin={thin} />
            </span>
            <span className="text-xs tabular-nums text-typography-700">
              {rateWords(r.rate)}
              {r.extra && <span className="block text-typography-500">{r.extra}</span>}
            </span>
          </div>
        );
      })}
      {top && rows.length > top && (
        <button
          type="button"
          className="mt-2 self-start text-xs text-blue-700 underline"
          onClick={() => setAll(v => !v)}
        >
          {all ? s.showFewer(top) : s.showAll(rows.length)}
        </button>
      )}
      {legend && (
        <p className="mt-2 text-xs text-typography-500">{s.thinLegend(MIN_RATE_SAMPLE)}</p>
      )}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Bullet rows: a value against its target                                    */
/* -------------------------------------------------------------------------- */

export const STATE_COLOR: Record<TargetState, string> = {
  met: PALETTE.green,
  missed: PALETTE.red,
  thin: CONTEXT.line,
  no_data: CONTEXT.faint,
};
const STATE_ICON: Record<TargetState, string> = {
  met: "✓",
  missed: "✕",
  thin: "·",
  no_data: "–",
};

/** The state in words with an icon, so it never rests on colour. */
export const StateBadge: React.FC<{ state: TargetState }> = ({ state }) => (
  <span
    className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium"
    style={{ color: state === "met" || state === "missed" ? STATE_COLOR[state] : CONTEXT.strong }}
    data-state={state}
  >
    <span aria-hidden>{STATE_ICON[state]}</span>
    {en.debriefs.metrics.states[state]}
  </span>
);

export interface BulletRow {
  key: string;
  label: string;
  /** The target in words, e.g. "≥ 85%". */
  targetLabel?: string;
  /** Measured value on the row's own scale, null when nothing was measured. */
  value: number | null;
  /** A second value drawn as a range end (p90 beside a p50). */
  upper?: number | null;
  /** 95% range of the value, drawn as a whisker. */
  ci?: { low: number | null; high: number | null };
  /** Target positions on the row's scale (a p50 and a p90 target, say). */
  targets?: number[];
  /** Axis 0..max for the row (or min..max for a two-sided measure). */
  min?: number;
  max: number;
  /** The value in words, right column. */
  words: ReactNode;
  state?: TargetState;
}

/**
 * Bullet chart rows: each measure on its own scale, with the measured bar
 * coloured by whether it is on target, its target as a dark rule, and a range
 * (p50–p90, or a 95% range) drawn as a thin whisker. A thin sample is grey.
 */
export const BulletRows: React.FC<{
  rows: BulletRow[];
  testId?: string;
  /** Column heads (label, axis, value) when the metrics page's own do not fit. */
  head?: [string, string, string];
}> = ({ rows, testId, head }) => {
  const c = en.debriefs.metrics.columns;
  const [hLabel, hAxis, hValue] = head ?? [
    c.metric,
    en.debriefs.metrics.charts.bulletAxis,
    c.window,
  ];
  return (
    <div className="flex flex-col" data-testid={testId}>
      <div className={`${GRID} mb-1 text-xs text-typography-500`}>
        <span className="hidden sm:block">{hLabel}</span>
        <span className="hidden sm:block">{hAxis}</span>
        <span className="hidden sm:block">{hValue}</span>
      </div>
      {rows.map(r => {
        const lo = r.min ?? 0;
        const span = r.max - lo || 1;
        const x = (v: number) => `${((Math.max(lo, Math.min(r.max, v)) - lo) / span) * 100}%`;
        const state = r.state;
        const color = state ? STATE_COLOR[state] : PALETTE.blue;
        const from = lo < 0 ? 0 : lo;
        return (
          <div
            key={r.key}
            className={`${GRID} items-center border-t border-gray-100 py-2`}
            data-testid={testId ? `${testId}-${r.key}` : undefined}
          >
            <span className="flex flex-col">
              <span className="text-xs text-typography-900">{r.label}</span>
              {r.targetLabel && (
                <span className="text-xs text-typography-500">
                  {en.debriefs.metrics.columns.target}: {r.targetLabel}
                </span>
              )}
            </span>
            {/* Top lane: the bar (and a p50–p90 range). Bottom lane: the 95% range. */}
            <span className="relative h-7" aria-hidden>
              <span className="absolute inset-x-0 top-1.5 h-2 rounded bg-gray-100" />
              {r.value != null && (
                <span
                  className="absolute top-1.5 h-2 rounded"
                  style={{
                    left: x(Math.min(from, r.value)),
                    width: `calc(${x(Math.max(from, r.value))} - ${x(Math.min(from, r.value))})`,
                    background: color,
                  }}
                />
              )}
              {r.value != null && r.upper != null && (
                <span
                  className="absolute top-[9px] h-0.5"
                  style={{
                    left: x(r.value),
                    width: `calc(${x(r.upper)} - ${x(r.value)})`,
                    background: color,
                  }}
                />
              )}
              {r.value != null && r.upper != null && (
                <span
                  className="absolute top-1 h-3 w-0.5"
                  style={{ left: x(r.upper), background: color }}
                />
              )}
              {r.ci?.low != null && r.ci.high != null && (
                <span
                  className="absolute top-[18px] h-1.5 border-x"
                  style={{
                    left: x(r.ci.low),
                    width: `calc(${x(r.ci.high)} - ${x(r.ci.low)})`,
                    borderColor: CONTEXT.line,
                  }}
                >
                  <span
                    className="absolute inset-x-0 top-1/2 h-px"
                    style={{ background: CONTEXT.line }}
                  />
                </span>
              )}
              {(r.targets ?? []).map(t => (
                <span
                  key={t}
                  className="absolute top-0 h-full w-0.5"
                  style={{ left: x(t), background: CONTEXT.strong }}
                />
              ))}
            </span>
            <span className="flex flex-wrap items-center gap-x-2 text-xs tabular-nums text-typography-700">
              <span>{r.words}</span>
              {state && <StateBadge state={state} />}
            </span>
          </div>
        );
      })}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Time ranges: median to slowest 10% per step                               */
/* -------------------------------------------------------------------------- */

export interface TimeRow {
  key: string;
  label: string;
  msP50: number | null;
  msP90: number | null;
}

/**
 * One bar per step from its median to its slowest 10%, on one seconds axis,
 * slowest first, so the step that holds a debrief up stands out.
 */
export const TimeRanges: React.FC<{ rows: TimeRow[]; testId?: string }> = ({ rows, testId }) => {
  const s = en.debriefs.metrics;
  const timed = rows.filter(r => r.msP50 != null);
  const untimed = rows.filter(r => r.msP50 == null);
  if (!timed.length) return <p className="text-xs text-typography-500">{s.charts.noTimes}</p>;
  const maxMs = Math.max(...timed.map(r => r.msP90 ?? r.msP50 ?? 0));
  const ceilS = Math.max(5, Math.ceil(maxMs / 1000 / 5) * 5);
  const x = (ms: number) => `${(ms / 1000 / ceilS) * 100}%`;
  const sorted = [...timed].sort((a, b) => (b.msP90 ?? b.msP50 ?? 0) - (a.msP90 ?? a.msP50 ?? 0));
  return (
    <div className="flex flex-col" data-testid={testId}>
      <div className={`${GRID} mb-1 text-xs text-typography-500`}>
        <span className="hidden sm:block" />
        <span className="flex justify-between tabular-nums">
          <span>0 s</span>
          <span>{ceilS / 2} s</span>
          <span>{ceilS} s</span>
        </span>
        <span className="hidden sm:block">{s.charts.timeAxis}</span>
      </div>
      {sorted.map(r => (
        <div
          key={r.key}
          className={`${GRID} items-center border-t border-gray-100 py-1.5`}
          data-testid={testId ? `${testId}-row` : undefined}
        >
          <span className="text-xs text-typography-900">{r.label}</span>
          <span className="relative h-5" aria-hidden>
            <span
              className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded"
              style={{
                left: x(r.msP50 ?? 0),
                width: `calc(${x(r.msP90 ?? r.msP50 ?? 0)} - ${x(r.msP50 ?? 0)})`,
                minWidth: "2px",
                background: STAT_RANGE,
              }}
            />
            <span
              className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
              style={{ left: x(r.msP50 ?? 0), background: PALETTE.blue }}
            />
          </span>
          <span className="text-xs tabular-nums text-typography-700">
            {s.agents.time(
              s.agents.seconds(r.msP50 ?? 0),
              r.msP90 == null ? s.none : s.agents.seconds(r.msP90),
            )}
          </span>
        </div>
      ))}
      {untimed.length > 0 && (
        <p className="mt-2 text-xs text-typography-500">
          {s.charts.notTimed(untimed.map(r => r.label).join(", "))}
        </p>
      )}
      <p className="mt-2 flex items-center gap-2 text-xs text-typography-500">
        <span
          aria-hidden
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ background: PALETTE.blue }}
        />
        {s.charts.timeLegend}
      </p>
    </div>
  );
};
const STAT_RANGE = PALETTE.cyan;

/* -------------------------------------------------------------------------- */
/* Agreement beyond chance (Cohen's κ) on a plain-language scale              */
/* -------------------------------------------------------------------------- */

const KAPPA_BANDS = [0, 0.2, 0.4, 0.6, 0.8, 1];

/** Plain words for a κ, on the usual Landis & Koch bands. */
export const kappaWords = (k: number): string => {
  const w = en.debriefs.metrics.charts.kappa.bands;
  if (k <= 0) return w[0];
  const i = KAPPA_BANDS.findIndex((b, j) => j > 0 && k <= b);
  return w[i === -1 ? 5 : i];
};

/** κ as a marker on a 0–1 strip divided into the plain-language bands. */
export const KappaScale: React.FC<{ kappa: number | null; n: number }> = ({ kappa, n }) => {
  const s = en.debriefs.metrics.charts.kappa;
  const bands = s.bands.slice(1);
  return (
    <div className="flex flex-col gap-1" data-testid="evaluator-kappa">
      <div className="relative">
        <div className="flex h-2 overflow-hidden rounded">
          {bands.map((b, i) => (
            <span
              key={b}
              className="h-full flex-1 border-r-2 border-white last:border-r-0"
              style={{ background: CONTEXT.faint, opacity: 0.35 + i * 0.13 }}
            />
          ))}
        </div>
        {kappa != null && (
          <span
            className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
            style={{
              left: `${Math.max(0, Math.min(1, kappa)) * 100}%`,
              background: n < MIN_RATE_SAMPLE ? CONTEXT.line : PALETTE.blue,
            }}
          />
        )}
      </div>
      <div className="flex text-[11px] leading-tight text-typography-500">
        {bands.map(b => (
          <span key={b} className="flex-1">
            {b}
          </span>
        ))}
      </div>
      <p className="text-xs text-typography-700">
        {kappa == null ? s.none : s.reading(kappa.toFixed(2), kappaWords(kappa).toLowerCase(), n)}
      </p>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

/** A ranked list of codes as thin bars, with the count beside each. */
export const CountBars: React.FC<{
  items: Array<{ label: string; count: number }>;
  limit?: number;
  testId?: string;
}> = ({ items, limit = 5, testId }) => {
  if (!items.length)
    return <p className="text-xs text-typography-500">{en.debriefs.metrics.none}</p>;
  const shown = [...items].sort((a, b) => b.count - a.count).slice(0, limit);
  const max = Math.max(...shown.map(i => i.count), 1);
  return (
    <ul className="flex flex-col gap-1" data-testid={testId}>
      {shown.map(i => (
        <li
          key={i.label}
          className="grid grid-cols-[minmax(6rem,12rem)_1fr_2.5rem] items-center gap-2 text-xs"
        >
          <span className="break-words text-typography-900">{i.label}</span>
          <span className="relative h-2" aria-hidden>
            <span
              className="absolute inset-y-0 left-0 rounded"
              style={{ width: `${(i.count / max) * 100}%`, background: PALETTE.blue }}
            />
          </span>
          <span className="text-right tabular-nums text-typography-700">{i.count}</span>
        </li>
      ))}
    </ul>
  );
};

/** A small labelled number inside an agent card. */
export const MiniStat: React.FC<{ label: string; value: ReactNode; testId?: string }> = ({
  label,
  value,
  testId,
}) => (
  <div className="flex flex-col" data-testid={testId}>
    <span className="text-xl font-medium text-typography-900">{value}</span>
    <span className="text-xs text-typography-500">{label}</span>
  </div>
);

/**
 * A segmented bar for a few counts that make up a whole (PM agent outcomes),
 * with every segment named in the legend underneath.
 */
export const SegmentBar: React.FC<{
  parts: Array<{ label: string; count: number; color: string }>;
  testId?: string;
}> = ({ parts, testId }) => {
  const total = parts.reduce((a, p) => a + p.count, 0);
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded bg-gray-100">
        {total > 0 &&
          parts
            .filter(p => p.count > 0)
            .map(p => (
              <span
                key={p.label}
                style={{ flexGrow: p.count, background: p.color }}
                title={`${p.label}: ${p.count}`}
              />
            ))}
      </div>
      <div className="flex flex-wrap gap-x-3 text-xs text-typography-700">
        {parts.map(p => (
          <span key={p.label} className="inline-flex items-center gap-1">
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-sm"
              style={{ background: p.color }}
            />
            {p.label} {p.count}
          </span>
        ))}
      </div>
    </div>
  );
};

/** A collapsed table of the exact numbers behind a chart (the chart's table view). */
export const NumbersTable: React.FC<{
  head: string[];
  rows: string[][];
  testId?: string;
  summary?: string;
}> = ({ head, rows, testId, summary }) => (
  <details className="mt-3 text-sm" data-testid={testId}>
    <summary className="cursor-pointer text-xs text-blue-700">
      {summary ?? en.debriefs.metrics.charts.showNumbers}
    </summary>
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-typography-700">
          <tr>
            {head.map(h => (
              <th key={h} className="py-1 pr-2 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.join("|")}-${i}`} className="border-t border-gray-200 align-top">
              {r.map((cell, j) => (
                <td key={j} className="py-1 pr-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </details>
);
