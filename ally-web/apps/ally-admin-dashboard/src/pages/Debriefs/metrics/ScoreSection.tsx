import React from "react";

import { useGetDebriefScoreQuery } from "@api";
import { en } from "@constants";
import { DebriefScoreView } from "@types";

import { ChartCard } from "../../Analytics/chartKit";
import { languageLabel } from "../consoleLabels";

/** Fewer debriefs than this in a slice and its score is too few to read (as elsewhere on the page). */
export const SCORE_MIN_N = 20;

const one = (v: number) => v.toFixed(1);

/** The answer-first heading: held, rose or fell, to one decimal. */
export const scoreHeadline = (view: Pick<DebriefScoreView, "current" | "previous">): string => {
  const t = en.debriefs.v2.score;
  if (view.current === null) return t.none;
  if (view.previous === null) return t.held(one(view.current));
  const d = Math.round((view.current - view.previous) * 10) / 10;
  if (d === 0) return t.held(one(view.current));
  return d > 0 ? t.rose(one(d), one(view.current)) : t.fell(one(-d), one(view.current));
};

const TONE: Record<string, string> = {
  up: "text-success-600",
  down: "text-destructive-600",
  flat: "text-neutral-600",
};

/** The weekly line with a mark where a change went live (green) or was undone (red). */
const ScoreChart: React.FC<{ view: DebriefScoreView }> = ({ view }) => {
  const t = en.debriefs.v2.score;
  const W = 600;
  const H = 150;
  const pad = 12;
  const weeks = view.byWeek;
  const vals = weeks.map(w => w.score).filter((v): v is number => v !== null);
  if (weeks.length === 0 || vals.length === 0) return null;
  const lo = Math.max(0, Math.floor(Math.min(...vals)) - 1);
  const hi = Math.min(10, Math.ceil(Math.max(...vals)) + 1);
  const x = (i: number) =>
    weeks.length === 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (weeks.length - 1);
  const y = (v: number) => H - pad - ((v - lo) / Math.max(1, hi - lo)) * (H - 2 * pad);
  const points = weeks
    .map((w, i) => (w.score === null ? null : `${x(i).toFixed(1)},${y(w.score).toFixed(1)}`))
    .filter(Boolean)
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-[150px] w-full"
      role="img"
      aria-label={t.chartLabel}
      data-testid="score-chart"
    >
      {view.markers.map(m => {
        const i = weeks.findIndex(w => w.week === m.week);
        if (i < 0) return null;
        return (
          <line
            key={`${m.kind}-${m.changeId}`}
            data-testid="score-marker"
            data-kind={m.kind}
            x1={x(i)}
            x2={x(i)}
            y1={pad / 2}
            y2={H - pad / 2}
            stroke={m.kind === "live" ? "#24A148" : "#DA1E28"}
            strokeWidth="2"
            strokeDasharray="4 3"
          >
            <title>{`${m.week}: ${m.title}`}</title>
          </line>
        );
      })}
      <polyline points={points} fill="none" stroke="#264D8E" strokeWidth="2.5" />
      {weeks.map((w, i) =>
        w.score === null ? null : (
          <circle key={w.week} cx={x(i)} cy={y(w.score)} r="3.5" fill="#264D8E">
            <title>{`${w.week}: ${one(w.score)} · ${t.debriefs(w.n)}`}</title>
          </circle>
        ),
      )}
    </svg>
  );
};

/**
 * Analytics › Debriefs, first (v2, U5): the overall score with its measures and change markers,
 * the two gates that are never traded off, and the score by language.
 */
export const ScoreSection: React.FC = () => {
  const t = en.debriefs.v2.score;
  const q = useGetDebriefScoreQuery({ days: 56 });
  const view = q.data;
  if (q.isError && !view) {
    return (
      <ChartCard
        title={t.label}
        error
        errorTitle={t.loadFailedTitle}
        errorSubtitle={t.loadFailedSubtitle}
        onRetry={() => void q.refetch()}
      />
    );
  }
  if (!view) return <ChartCard title={t.label} loading />;
  const rows = [
    ...view.measures.map(m => ({
      key: m.key,
      name: m.label,
      role:
        m.key === "flags"
          ? t.weightFlags(Math.round(m.weight * 100))
          : t.weight(Math.round(m.weight * 100)),
      value: m.display,
      trend: m.trend,
      tone: m.tone,
    })),
    ...view.gates.map(g => ({
      key: g.key,
      name: g.label,
      role: t.gateRole[g.key] ?? "",
      value: g.display,
      trend: g.ok ? t.gateOk : t.gateTripped,
      tone: g.ok ? "up" : "down",
    })),
  ];
  return (
    <section
      aria-labelledby="debrief-score"
      className="flex flex-col gap-4"
      data-testid="score-section"
    >
      <h2 id="debrief-score" className="m-0 max-w-[980px] text-xl font-normal text-typography-900">
        {scoreHeadline(view)}
      </h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-2 rounded-sm bg-neutral-50 px-5 py-4">
          <div className="text-sm text-neutral-700">{t.label}</div>
          <div className="flex flex-nowrap items-baseline gap-3">
            <span className="text-[40px] font-light leading-none" data-testid="score-current">
              {view.current === null ? "—" : one(view.current)}
            </span>
            <span className="truncate text-[13px] text-neutral-600">
              {view.previous === null
                ? t.noLastWeek(view.debriefs)
                : t.lastWeek(one(view.previous), view.debriefs)}
            </span>
          </div>
          <ScoreChart view={view} />
          <p className="m-0 text-xs text-neutral-600">{t.markersHelp}</p>
        </div>
        <div className="flex flex-col rounded-sm bg-neutral-50" data-testid="score-measures">
          {rows.map(r => (
            <div
              key={r.key}
              data-testid={`score-measure-${r.key}`}
              className="flex flex-nowrap items-center gap-3 border-b border-neutral-100 px-4 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{r.name}</div>
                <div className="truncate text-xs text-neutral-600">{r.role}</div>
              </div>
              <span className="shrink-0 text-base font-semibold">{r.value}</span>
              <span className={`w-16 shrink-0 text-right text-[13px] ${TONE[r.tone] ?? ""}`}>
                {r.trend}
              </span>
            </div>
          ))}
          <a href="#debrief-score-language" className="px-4 py-2.5 text-[13px]">
            {t.byLanguage}
          </a>
        </div>
      </div>
      {view.byLanguage.length > 0 && (
        <div
          id="debrief-score-language"
          className="flex flex-col gap-2 rounded-sm bg-neutral-50 px-5 py-4"
          data-testid="score-by-language"
        >
          <h3 className="m-0 text-base font-semibold">{t.byLanguageHeading}</h3>
          <p className="m-0 text-xs text-neutral-600">{t.byLanguageHelp}</p>
          {view.byLanguage.map(l => {
            const thin = l.n < SCORE_MIN_N;
            const w = l.score === null ? 0 : Math.max(0, Math.min(10, l.score)) * 10;
            return (
              <div key={l.language} className="flex flex-nowrap items-center gap-3 text-sm">
                <span className="w-28 shrink-0 truncate">{languageLabel(l.language)}</span>
                <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-sm bg-neutral-100">
                  <span
                    className={`block h-full ${thin ? "bg-neutral-400" : "bg-primary-500"}`}
                    style={{ width: `${w}%` }}
                  />
                </span>
                <span className="w-12 shrink-0 text-right font-semibold">
                  {l.score === null ? "—" : one(l.score)}
                </span>
                <span className="w-44 shrink-0 truncate text-xs text-neutral-600">
                  {thin ? t.tooFew(l.n) : t.debriefs(l.n)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
