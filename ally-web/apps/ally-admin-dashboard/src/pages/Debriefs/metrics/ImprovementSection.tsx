import React, { useState } from "react";

import { useGetDebriefScoreQuery } from "@api";
import { en } from "@constants";
import { DebriefScoreView } from "@types";

import { ChartCard } from "../../Analytics/chartKit";

/** Fewer debriefs than this in a point's four weeks and the point is hollow (too few to read). */
export const IMPROVE_MIN_N = 20;

/** Days of weekly points the chart shows (12 weeks). One request serves the whole page. */
export const SCORE_DAYS = 84;

type Rolling = NonNullable<DebriefScoreView["rolling"]>[number];
type LineKey = "overall" | "pass" | "helpful" | "notFlagged";

/**
 * Line colours: the total in the strongest blue, its three other parts in validated categorical
 * slots (adjacent CVD ΔE ≥ 9). Every line is also direct-labelled, so colour never carries it alone.
 */
const LINES: Array<{ key: LineKey; color: string; width: number; measure: string }> = [
  { key: "overall", color: "#2a78d6", width: 3, measure: "" },
  { key: "pass", color: "#eb6834", width: 2, measure: "pass" },
  { key: "helpful", color: "#1baf7a", width: 2, measure: "helpful" },
  { key: "notFlagged", color: "#6250d6", width: 2, measure: "flags" },
];

/** One fixed colour per rubric check, in the rubric's own order (heaviest first), never by rank. */
export const DIM_COLORS: Record<string, string> = {
  evidence_specificity: "#2a78d6",
  accuracy: "#eb6834",
  actionability: "#1baf7a",
  prioritisation: "#eda100",
  personalisation_progress: "#e87ba4",
  practice_alignment: "#008300",
  tone: "#6250d6",
  clarity: "#e34948",
};
const DIM_ORDER = Object.keys(DIM_COLORS);

/** A point's value on the chart's 0–100 scale: the overall is out of 10, the rest are shares. */
export const toPct = (p: Rolling, key: LineKey): number | null => {
  const v = p[key];
  if (v == null) return null;
  return key === "overall" ? v * 10 : v * 100;
};

const fmt = (p: Rolling, key: LineKey): string => {
  const v = p[key];
  if (v == null) return "—";
  return key === "overall" ? `${v.toFixed(1)} / 10` : `${Math.round(v * 100)}%`;
};

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

/** The headline: the latest four weeks against the four before, when both have enough debriefs. */
export const improveHeadline = (rolling: Rolling[]): string => {
  const t = en.debriefs.v2.improve;
  const last = rolling[rolling.length - 1];
  if (!last || last.overall == null) return t.headlineNone;
  const prev = rolling.length > 4 ? rolling[rolling.length - 5] : null;
  const v = last.overall.toFixed(1);
  if (!prev || prev.overall == null || prev.n < IMPROVE_MIN_N || last.n < IMPROVE_MIN_N) {
    return t.headline(v);
  }
  const d = Math.round((last.overall - prev.overall) * 10) / 10;
  if (d === 0) return t.headline(v);
  return d > 0 ? t.headlineUp(d.toFixed(1), v) : t.headlineDown((-d).toFixed(1), v);
};

/** The lines chart: the overall score and its three other parts, each point over four weeks. */
const LinesChart: React.FC<{ view: DebriefScoreView; weights: Record<string, number> }> = ({
  view,
  weights,
}) => {
  const t = en.debriefs.v2.improve;
  const [hover, setHover] = useState<number | null>(null);
  const pts = view.rolling ?? [];
  if (pts.length === 0) return null;
  const W = 640;
  const H = 240;
  const L = 34;
  const R = 112;
  const T = 10;
  const B = 26;
  const x = (i: number) =>
    pts.length === 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (pts.length - 1);
  const y = (v: number) => T + (1 - v / 100) * (H - T - B);
  const lastIdx = pts.length - 1;

  // Direct labels at the right end, nudged apart so they never overlap.
  const ends = LINES.map(l => {
    let i = lastIdx;
    while (i >= 0 && toPct(pts[i], l.key) == null) i--;
    return { ...l, i, v: i >= 0 ? (toPct(pts[i], l.key) as number) : null };
  })
    .filter(e => e.v != null)
    .sort((a, b) => (b.v as number) - (a.v as number));
  let prevY = -Infinity;
  const labelY = new Map<LineKey, number>();
  for (const e of ends) {
    const yy = Math.max(y(e.v as number), prevY + 14);
    labelY.set(e.key, yy);
    prevY = yy;
  }

  const hp = hover == null ? null : pts[hover];
  const tipLeft = hover == null ? 0 : (x(hover) / W) * 100;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[240px] w-full"
        role="img"
        aria-label={t.chartLabel}
        data-testid="improve-chart"
        onMouseLeave={() => setHover(null)}
      >
        {[0, 25, 50, 75, 100].map(g => (
          <g key={g}>
            <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} stroke="#e0e0e0" strokeWidth="1" />
            <text x={L - 6} y={y(g) + 4} textAnchor="end" fontSize="11" fill="#6f6f6f">
              {g}
            </text>
          </g>
        ))}
        {pts.map((p, i) =>
          i % 2 === lastIdx % 2 ? (
            <text key={p.week} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="#6f6f6f">
              {shortDate(p.week)}
            </text>
          ) : null,
        )}
        {view.markers.map(m => {
          const i = pts.findIndex(p => p.week === m.week);
          if (i < 0) return null;
          return (
            <line
              key={`${m.kind}-${m.changeId}`}
              data-testid="improve-marker"
              data-kind={m.kind}
              x1={x(i)}
              x2={x(i)}
              y1={T}
              y2={H - B}
              stroke={m.kind === "live" ? "#24A148" : "#DA1E28"}
              strokeWidth="1.5"
              strokeDasharray="4 3"
            >
              <title>{`${m.week}: ${m.title}`}</title>
            </line>
          );
        })}
        {hover != null && (
          <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="#8d8d8d" strokeWidth="1" />
        )}
        {LINES.map(l => {
          // Break the line where a point has no value; never draw through a gap.
          const segs: string[][] = [[]];
          pts.forEach((p, i) => {
            const v = toPct(p, l.key);
            if (v == null) segs.push([]);
            else segs[segs.length - 1].push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
          });
          return (
            <g key={l.key} data-testid={`improve-line-${l.key}`}>
              {segs
                .filter(s => s.length > 1)
                .map((s, k) => (
                  <polyline
                    key={k}
                    points={s.join(" ")}
                    fill="none"
                    stroke={l.color}
                    strokeWidth={l.width}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ))}
              {pts.map((p, i) => {
                const v = toPct(p, l.key);
                if (v == null) return null;
                const thin = p.n < IMPROVE_MIN_N;
                return (
                  <circle
                    key={p.week}
                    data-testid={thin ? "improve-point-thin" : "improve-point"}
                    cx={x(i)}
                    cy={y(v)}
                    r={l.key === "overall" ? 4.5 : 3.5}
                    fill={thin ? "#ffffff" : l.color}
                    stroke={thin ? l.color : "#ffffff"}
                    strokeWidth={thin ? 2 : 1.5}
                  />
                );
              })}
              {labelY.has(l.key) && (
                <text
                  x={W - R + 8}
                  y={(labelY.get(l.key) as number) + 4}
                  fontSize="12"
                  fill="#393939"
                  fontWeight={l.key === "overall" ? 600 : 400}
                >
                  {`${t.lines[l.key]} ${fmt(pts[ends.find(e => e.key === l.key)?.i ?? lastIdx], l.key).replace(" / 10", "")}`}
                </text>
              )}
            </g>
          );
        })}
        {/* Hover targets: one band a week, wider than any mark. */}
        {pts.map((p, i) => {
          const half = pts.length > 1 ? (W - L - R) / (pts.length - 1) / 2 : (W - L - R) / 2;
          return (
            <rect
              key={p.week}
              data-testid="improve-hit"
              x={x(i) - half}
              y={T}
              width={half * 2}
              height={H - T - B}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          );
        })}
      </svg>
      {hp && (
        <div
          role="tooltip"
          data-testid="improve-tooltip"
          className="pointer-events-none absolute top-2 z-10 w-56 rounded-sm border border-neutral-200 bg-white px-3 py-2 text-xs shadow-md"
          style={{
            left: `${Math.min(Math.max(tipLeft, 0), 100)}%`,
            transform: tipLeft > 55 ? "translateX(-105%)" : "translateX(8px)",
          }}
        >
          <div className="mb-1 font-semibold text-typography-900">
            {t.weekOf(shortDate(hp.week))}
          </div>
          {LINES.map(l => (
            <div key={l.key} className="flex flex-nowrap items-center gap-2 py-0.5">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ background: l.color }}
              />
              <span className="min-w-0 flex-1 truncate text-neutral-700">{t.lines[l.key]}</span>
              <span className="shrink-0 font-semibold text-typography-900">{fmt(hp, l.key)}</span>
            </div>
          ))}
          <div className="mt-1 text-neutral-600">{t.tipDebriefs(hp.n)}</div>
        </div>
      )}
      <ul
        className="m-0 mt-2 flex list-none flex-wrap gap-x-4 gap-y-1 p-0"
        data-testid="improve-legend"
      >
        {LINES.map(l => (
          <li
            key={l.key}
            className="flex flex-nowrap items-center gap-1.5 text-xs text-neutral-700"
            title={t.lineHelp[l.key]}
          >
            <span
              className="inline-block shrink-0 rounded-full"
              style={{ background: l.color, width: 14, height: l.width + 1 }}
            />
            <span className="whitespace-nowrap">{t.lines[l.key]}</span>
            {l.measure && weights[l.measure] != null && (
              <span className="whitespace-nowrap text-neutral-500">
                {t.weight(Math.round(weights[l.measure] * 100))}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

const arrow = (score: number | null, previous: number | null) => {
  if (score == null || previous == null) return null;
  const d = Math.round((score - previous) * 10) / 10;
  if (d === 0) return { text: "–", cls: "text-neutral-500", label: "about the same" };
  return d > 0
    ? { text: `▲${d.toFixed(1)}`, cls: "text-success-600", label: `up ${d.toFixed(1)}` }
    : {
        text: `▼${(-d).toFixed(1)}`,
        cls: "text-destructive-600",
        label: `down ${(-d).toFixed(1)}`,
      };
};

/** The quality score in detail: one bar out of 10, a coloured share per check, grey for what was lost. */
const QualityPanel: React.FC<{ quality: NonNullable<DebriefScoreView["quality"]> }> = ({
  quality,
}) => {
  const t = en.debriefs.v2.improve;
  const byKey = new Map(quality.dimensions.map(d => [d.key, d]));
  const segments = DIM_ORDER.map(k => byKey.get(k)).filter(
    (d): d is NonNullable<typeof d> => !!d && d.score != null,
  );
  const got = segments.reduce((a, d) => a + d.weight * (d.score as number), 0);
  const lostTotal = Math.max(0, 10 - got);
  const head = arrow(quality.current, quality.previous);
  return (
    <div
      className="flex flex-col gap-3 rounded-sm bg-neutral-50 px-5 py-4"
      data-testid="quality-panel"
    >
      <div className="text-sm text-neutral-700" title={t.qualityHelp}>
        {t.quality}
      </div>
      {quality.current == null ? (
        <p className="m-0 text-sm text-neutral-600">{t.qualityNone}</p>
      ) : (
        <>
          <div className="flex flex-nowrap items-baseline gap-3">
            <span className="text-[32px] font-light leading-none" data-testid="quality-current">
              {quality.current.toFixed(1)}
            </span>
            <span className="text-sm text-neutral-600">/ 10</span>
            <span className={`truncate text-[13px] ${head?.cls ?? "text-neutral-600"}`}>
              {head ? t.qualityVs(head.text) : t.qualityN(quality.n)}
            </span>
          </div>
          <div
            className="flex h-4 w-full flex-nowrap gap-[2px] overflow-hidden rounded-sm"
            role="img"
            aria-label={t.qualityHelp}
            data-testid="quality-bar"
          >
            {segments.map(d => {
              const share = d.weight * (d.score as number);
              const name = t.dims[d.key] ?? d.key;
              return (
                <span
                  key={d.key}
                  data-testid={`quality-seg-${d.key}`}
                  className="block h-full"
                  style={{ width: `${share * 10}%`, background: DIM_COLORS[d.key] ?? "#8d8d8d" }}
                  title={t.dimTip(name, share.toFixed(2), (d.weight * 10).toFixed(1))}
                />
              );
            })}
            {lostTotal > 0.005 && (
              <span
                className="block h-full bg-neutral-200"
                style={{ width: `${lostTotal * 10}%` }}
                title={t.lost(lostTotal.toFixed(1))}
              />
            )}
          </div>
          <ul className="m-0 flex list-none flex-col p-0" data-testid="quality-legend">
            {quality.dimensions.map(d => {
              const a = arrow(d.score, d.previous);
              const name = t.dims[d.key] ?? d.key;
              return (
                <li
                  key={d.key}
                  data-testid={`quality-row-${d.key}`}
                  className="flex flex-nowrap items-center gap-2 border-b border-neutral-100 py-1.5 text-sm"
                >
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: DIM_COLORS[d.key] ?? "#8d8d8d" }}
                  />
                  <span className="min-w-0 flex-1 truncate" title={name}>
                    {name}
                  </span>
                  <span className="w-10 shrink-0 text-right text-xs text-neutral-500">
                    {Math.round(d.weight * 100)}%
                  </span>
                  <span className="w-10 shrink-0 text-right font-semibold">
                    {d.score == null ? "—" : d.score.toFixed(1)}
                  </span>
                  <span
                    className={`w-12 shrink-0 text-right text-xs ${a?.cls ?? ""}`}
                    aria-label={a?.label}
                  >
                    {a?.text ?? ""}
                  </span>
                  <span className="w-16 shrink-0 text-right text-xs text-neutral-600">
                    {d.lost == null || d.lost < 0.005 ? "" : `−${d.lost.toFixed(2)}`}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="m-0 text-xs text-neutral-600">
            {t.lost(lostTotal.toFixed(1))}
            {head ? ` · ${t.qualityN(quality.n)}` : ""}
          </p>
        </>
      )}
    </div>
  );
};

/** The two checks never traded against the score: quiet when holding, red when broken. */
const GateTiles: React.FC<{ gates: DebriefScoreView["gates"] }> = ({ gates }) => {
  const t = en.debriefs.v2.improve;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="gate-tiles">
      {gates.map(g => (
        <div
          key={g.key}
          data-testid={`gate-${g.key}`}
          data-ok={g.ok}
          className={`flex flex-nowrap items-center gap-3 rounded-sm px-4 py-3 ${
            g.ok ? "bg-neutral-50" : "border border-destructive-600 bg-destructive-50"
          }`}
        >
          <span
            aria-hidden
            className={`shrink-0 text-base ${g.ok ? "text-success-600" : "text-destructive-600"}`}
          >
            {g.ok ? "✓" : "✕"}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{g.label}</div>
            <div className="truncate text-xs text-neutral-600" title={g.display}>
              {g.display}
            </div>
          </div>
          <span
            className={`shrink-0 text-xs font-semibold ${g.ok ? "text-neutral-600" : "text-destructive-600"}`}
          >
            {g.ok ? t.gateOk : t.gateBroken}
          </span>
        </div>
      ))}
    </div>
  );
};

/**
 * Analytics › Debriefs, first: what the system improves. One chart (the overall score and its
 * parts, four weeks a point), the quality score in detail beside it, and the two gates.
 */
export const ImprovementSection: React.FC = () => {
  const t = en.debriefs.v2.improve;
  const q = useGetDebriefScoreQuery({ days: SCORE_DAYS });
  const view = q.data;
  if (q.isError && !view) {
    return (
      <ChartCard
        title={t.heading}
        error
        errorTitle={en.debriefs.v2.score.loadFailedTitle}
        errorSubtitle={en.debriefs.v2.score.loadFailedSubtitle}
        onRetry={() => void q.refetch()}
      />
    );
  }
  if (!view) return <ChartCard title={t.heading} loading />;
  const weights = Object.fromEntries(view.measures.map(m => [m.key, m.weight]));
  return (
    <section
      aria-labelledby="debrief-improve"
      className="flex flex-col gap-4"
      data-testid="improve-section"
    >
      <h2
        id="debrief-improve"
        className="m-0 max-w-[980px] text-xl font-normal text-typography-900"
      >
        {improveHeadline(view.rolling ?? [])}
      </h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-2 rounded-sm bg-neutral-50 px-5 py-4">
          <div className="text-sm text-neutral-700">{t.heading}</div>
          <LinesChart view={view} weights={weights} />
          <p className="m-0 text-xs text-neutral-600">{t.note}</p>
        </div>
        {view.quality && <QualityPanel quality={view.quality} />}
      </div>
      <GateTiles gates={view.gates} />
    </section>
  );
};
