import React from "react";

import { formatUsd } from "@components/ally-guide/allyGuideFormat";
import { en } from "@constants";
import { DebriefMetricsView, DebriefRate, DebriefSafetyRecallRun } from "@types";

import { BulletRow, BulletRows } from "./metricsCharts";
import { Target, niceCeiling, pctNum, rangeOf, sumRates, targetState } from "./metricsData";
import { Words, fixed, pct } from "./metricsShared";
import { ChartCard } from "../../Analytics/chartKit";

/** A whole-window rate as a bullet row on a 0..max % scale. */
export const rateBullet = (
  key: string,
  label: string,
  whole: DebriefRate,
  opts: {
    target?: Target;
    targetLabel?: string;
    latest?: DebriefRate | null;
    max?: number;
  } = {},
): BulletRow => {
  const sec = en.debriefs.metrics.sections;
  const t = opts.target?.atLeast ?? opts.target?.atMost;
  const ci = rangeOf(whole);
  return {
    key,
    label,
    targetLabel: opts.targetLabel,
    value: whole.value,
    ci,
    targets: t == null ? [] : [t],
    max: opts.max ?? niceCeiling([ci.high ?? whole.value ?? 0, t ?? 0]),
    words: (
      <Words
        main={
          whole.value == null
            ? en.debriefs.metrics.none
            : `${pctNum(whole.value)} (${en.debriefs.metrics.count(whole.n, whole.of)})`
        }
        sub={opts.latest ? sec.thisWeek(pct(opts.latest)) : undefined}
      />
    ),
    state: opts.target ? targetState(whole.value, opts.target, whole.of) : undefined,
  };
};

export const GuardrailsCard: React.FC<{ view: DebriefMetricsView }> = ({ view }) => {
  const s = en.debriefs.metrics;
  const series = view.series;
  const g = series[series.length - 1]?.guardrails;
  const windowHardFail = sumRates(series.map(w => w.guardrails.hardFailRate));
  const fabricated = series.reduce((a, w) => a + w.guardrails.fabricatedQuotes, 0);
  const legacyHf = view.baselines.legacyHardFailRate.value;
  const p90s = g?.visibleSecondsP90 ?? 0;
  const cost90 = g?.costP90 ?? 0;
  const rows: BulletRow[] = [
    rateBullet("hard-fail", s.guardrails.hardFailRate, windowHardFail, {
      target: legacyHf == null ? {} : { atMost: legacyHf },
      targetLabel: s.guardrails.legacy(pct(view.baselines.legacyHardFailRate)),
      latest: g?.hardFailRate,
    }),
    {
      key: "fabricated",
      label: s.guardrails.fabricated,
      targetLabel: "0",
      value: fabricated,
      targets: [0],
      max: Math.max(5, fabricated),
      words: (
        <Words
          main={String(fabricated)}
          sub={s.sections.thisWeek(String(g?.fabricatedQuotes ?? 0))}
        />
      ),
      state: fabricated > 0 ? "missed" : series.some(w => w.debriefs) ? "met" : "no_data",
    },
    {
      key: "visible",
      label: s.guardrails.visible,
      targetLabel: "≤ 75 s / ≤ 120 s",
      value: g?.visibleSecondsP50 ?? null,
      upper: g?.visibleSecondsP90 ?? null,
      targets: [75, 120],
      max: Math.max(150, Math.ceil((p90s * 1.1) / 30) * 30),
      words: (
        <Words
          main={`${fixed(g?.visibleSecondsP50, 0)} s / ${fixed(g?.visibleSecondsP90, 0)} s`}
          sub={s.columns.latest}
        />
      ),
      state:
        g?.visibleSecondsP50 == null
          ? "no_data"
          : g.visibleSecondsP50 <= 75 && (g.visibleSecondsP90 ?? 0) <= 120
            ? "met"
            : "missed",
    },
    {
      key: "cost",
      label: s.guardrails.cost,
      targetLabel: "≤ $0.20 median",
      value: g?.costP50 ?? null,
      upper: g?.costP90 ?? null,
      targets: [0.2],
      max: Math.max(0.3, Math.ceil(cost90 * 1.2 * 10) / 10),
      words: (
        <Words
          main={`${g?.costP50 == null ? s.none : formatUsd(g.costP50)} / ${g?.costP90 == null ? s.none : formatUsd(g.costP90)}`}
          sub={s.columns.latest}
        />
      ),
      state: targetState(g?.costP50 ?? null, { atMost: 0.2 }),
    },
    {
      key: "gap",
      label: s.guardrails.gap,
      targetLabel: "≤ 0.5",
      value: g?.evaluatorJudgeGap ?? null,
      targets: [-0.5, 0.5],
      min: -Math.max(1.5, Math.abs(g?.evaluatorJudgeGap ?? 0)),
      max: Math.max(1.5, Math.abs(g?.evaluatorJudgeGap ?? 0)),
      words: <Words main={fixed(g?.evaluatorJudgeGap, 2)} sub={s.columns.latest} />,
      state:
        g?.evaluatorJudgeGap == null
          ? "no_data"
          : Math.abs(g.evaluatorJudgeGap) <= 0.5
            ? "met"
            : "missed",
    },
    safetyRow(view.safetyRecall),
  ];
  const history = view.safetyRecall?.recorded ? view.safetyRecall.history : [];
  return (
    <ChartCard title={s.guardrails.heading} caption={s.sections.guardrailsCaption}>
      <BulletRows rows={rows} testId="metrics-guardrails" />
      {history.length > 1 && (
        <details className="mt-2 text-xs text-typography-700" data-testid="safety-recall-history">
          <summary className="cursor-pointer text-primary-500">
            {s.guardrails.safetyHistory}
          </summary>
          <ul className="mt-1 flex flex-col gap-1">
            {history.map(r => (
              <li key={`${r.ideaId}-${r.ranAt}`}>
                {r.passed ? s.guardrails.safetyPassed : s.guardrails.safetyFailed} · {safetyWhen(r)}{" "}
                · {repsLine(r)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </ChartCard>
  );
};

export const repsLine = (r: DebriefSafetyRecallRun) =>
  r.reps.length ? r.reps.map(x => `${Math.round(x.recall * 100)}%`).join(" · ") : "—";

export const safetyWhen = (r: DebriefSafetyRecallRun) => {
  const s = en.debriefs.metrics.guardrails;
  const when = r.ranAt
    ? new Date(r.ranAt).toLocaleDateString("en-GB", { dateStyle: "medium" })
    : "";
  const who =
    r.releaseVersion != null
      ? `${r.challenger} (${s.safetyRelease(r.releaseVersion)})`
      : r.challenger;
  return s.safetyLatest(
    when,
    who,
    r.cases != null && r.planted != null ? s.safetyCases(r.cases, r.planted) : "",
  );
};

/**
 * Plan §9 "safety recall 100% × 3": the latest gate's reading of the seeded
 * safety set — each repetition's recall, pass or fail, when, and which
 * challenger it gated.
 */
export const safetyRow = (m: DebriefMetricsView["safetyRecall"] | undefined): BulletRow => {
  const s = en.debriefs.metrics.guardrails;
  if (!m?.recorded) {
    return {
      key: "safety",
      label: s.safety,
      targetLabel: "100% × 3",
      value: null,
      max: 1,
      words: s.safetyNote,
      state: "no_data",
    };
  }
  const r = m.latest;
  const lowest = r.reps.length ? Math.min(...r.reps.map(x => x.recall)) : null;
  return {
    key: "safety",
    label: s.safety,
    targetLabel: "100% × 3",
    value: lowest,
    targets: [1],
    max: 1,
    words: (
      <Words
        main={
          r.error && !r.reps.length
            ? s.safetyFailedToRun(r.error)
            : `${r.passed ? s.safetyPassed : s.safetyFailed} · ${s.safetyReps(repsLine(r))}`
        }
        sub={safetyWhen(r)}
      />
    ),
    state: r.passed ? "met" : "missed",
  };
};
