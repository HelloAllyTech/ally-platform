import React, { useMemo, useState } from "react";

import { useGetDebriefMetricsQuery } from "@api";
import { formatUsd } from "@components/ally-guide/allyGuideFormat";
import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { Pill, PillTone } from "@components/ally-guide/Pill";
import { LineChart } from "@components/charts";
import { en } from "@constants";
import {
  DebriefExperienceRates,
  DebriefFilterOptions,
  DebriefMetricsFilter,
  DebriefMetricsView,
  DebriefPassBreakdownRow,
  DebriefPassGroup,
  DebriefRate,
} from "@types";

import { ChartCard, lineOpts, PALETTE } from "../Analytics/chartKit";

/** Below this many in the denominator a rate is too few to read (matches ally-be). */
export const MIN_RATE_SAMPLE = 20;
const WEEK_CHOICES = [8, 12, 26] as const;

type State = "met" | "missed" | "thin" | "no_data";
const TONE: Record<State, PillTone> = {
  met: "success",
  missed: "danger",
  thin: "neutral",
  no_data: "neutral",
};

/** How a value stands against its v9 target. */
export const targetState = (
  value: number | null,
  target: { atLeast?: number; atMost?: number },
  sample?: number,
): State => {
  if (value == null) return "no_data";
  if (sample != null && sample < MIN_RATE_SAMPLE) return "thin";
  if (target.atLeast != null && value < target.atLeast) return "missed";
  if (target.atMost != null && value > target.atMost) return "missed";
  return "met";
};

const pct = (r: DebriefRate | null | undefined) =>
  r?.value == null ? en.debriefs.metrics.none : `${Math.round(r.value * 1000) / 10}%`;
const fixed = (x: number | null | undefined, d = 1) =>
  x == null ? en.debriefs.metrics.none : x.toFixed(d);

/** Adds a rate's counts to its denominator-free twin: the whole window's total. */
const sumRates = (rates: DebriefRate[]): DebriefRate => {
  const n = rates.reduce((a, r) => a + r.n, 0);
  const of = rates.reduce((a, r) => a + r.of, 0);
  return { n, of, value: of > 0 ? n / of : null };
};

const StateCell: React.FC<{ state: State }> = ({ state }) => (
  <Pill tone={TONE[state]}>{en.debriefs.metrics.states[state]}</Pill>
);

/** The debrief's success metrics (v9 §3.3, PRD §4), for switched-on organisations. */
export const MetricsTab: React.FC = () => {
  const s = en.debriefs.metrics;
  const [weeks, setWeeks] = useState<number>(12);
  const [filter, setFilter] = useState<DebriefMetricsFilter>({});
  const q = useGetDebriefMetricsQuery({ weeks, ...filter });

  if (q.isError) {
    return <ErrorPanel what={s.loadFailed} error={q.error} onRetry={() => void q.refetch()} />;
  }
  if (!q.data) return <LoadingBlock lines={10} />;
  return (
    <MetricsBody
      view={q.data}
      weeks={weeks}
      onWeeks={setWeeks}
      filter={filter}
      onFilter={setFilter}
    />
  );
};

const MetricsBody: React.FC<{
  view: DebriefMetricsView;
  weeks: number;
  onWeeks: (n: number) => void;
  filter: DebriefMetricsFilter;
  onFilter: (f: DebriefMetricsFilter) => void;
}> = ({ view, weeks, onWeeks, filter, onFilter }) => {
  const s = en.debriefs.metrics;
  const series = view.series;
  const last = series[series.length - 1];

  const chart = useMemo(
    () =>
      series.flatMap(w => [
        { group: s.steering.series.score, key: w.week, value: w.steering.value },
        {
          group: s.steering.series.judge,
          key: w.week,
          value: w.steering.components.judge == null ? null : w.steering.components.judge * 10,
        },
        {
          group: s.steering.series.practise,
          key: w.week,
          value:
            w.steering.components.practise.value == null
              ? null
              : Math.round(w.steering.components.practise.value * 1000) / 10,
        },
        {
          group: s.steering.series.thumbs,
          key: w.week,
          value:
            w.steering.components.thumbs.value == null
              ? null
              : Math.round(w.steering.components.thumbs.value * 1000) / 10,
        },
      ]),
    [series, s],
  );
  const hasScore = series.some(w => w.steering.value != null);
  const partialWeeks = series.filter(w => w.steering.value != null && w.steering.missing.length);

  const window = (pick: (e: DebriefExperienceRates) => DebriefRate) =>
    sumRates(series.map(w => pick(w.experience)));
  const g = last?.guardrails;
  const windowHardFail = sumRates(series.map(w => w.guardrails.hardFailRate));
  const windowThumbsDown = sumRates(series.map(w => w.guardrails.thumbsDownRate));
  const fabricated = series.reduce((a, w) => a + w.guardrails.fabricatedQuotes, 0);
  const legacyHf = view.baselines.legacyHardFailRate.value;
  const preThumbs = view.baselines.legacyThumbsDownRate.value;

  const experienceRows: Array<{
    label: string;
    pick: (e: DebriefExperienceRates) => DebriefRate;
    target?: { atLeast?: number; atMost?: number };
    targetLabel: string;
  }> = [
    {
      label: s.experience.openedWithin24h,
      pick: e => e.openedWithin24h,
      target: { atLeast: 0.85 },
      targetLabel: "≥ 85%",
    },
    {
      label: s.experience.readThrough,
      pick: e => e.readThrough,
      target: { atLeast: 0.7 },
      targetLabel: "≥ 70%",
    },
    {
      label: s.experience.practiseClickThrough,
      pick: e => e.practiseClickThrough,
      target: { atLeast: 0.25 },
      targetLabel: "≥ 25%",
    },
    {
      label: s.experience.reflectionAnswered,
      pick: e => e.reflectionAnswered,
      target: { atLeast: 0.15 },
      targetLabel: "≥ 15%",
    },
    {
      label: s.experience.abandonedBeforeReady,
      pick: e => e.abandonedBeforeReady,
      target: { atMost: 0.1 },
      targetLabel: "≤ 10%",
    },
    {
      label: s.experience.flagsWithinSla(view.flagReviewSlaHours),
      pick: e => e.flagsWithinSla,
      target: { atLeast: 0.95 },
      targetLabel: "≥ 95%",
    },
    { label: s.experience.listened, pick: e => e.listened, targetLabel: s.experience.noTarget },
    { label: s.experience.replied, pick: e => e.replied, targetLabel: s.experience.noTarget },
  ];

  return (
    <div className="flex flex-col gap-8" data-testid="debrief-metrics-tab">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-normal text-typography-900">{s.heading}</h2>
          <p className="max-w-3xl pt-1 text-sm text-typography-700">{s.help}</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only">{s.weeks(weeks)}</span>
          <select
            aria-label="Window"
            className="rounded border border-gray-300 px-2 py-1"
            value={weeks}
            onChange={e => onWeeks(Number(e.target.value))}
          >
            {WEEK_CHOICES.map(n => (
              <option key={n} value={n}>
                {s.weeks(n)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <FilterBar options={view.filterOptions} filter={filter} onFilter={onFilter} />
      <QualitySection quality={view.quality} />
      <AgentsSection agents={view.agents} />

      <section className="flex flex-col gap-2" data-testid="metrics-steering">
        <ChartCard
          title={s.steering.heading}
          titleHelp={<InfoTip label={s.steering.help} ariaLabel="About the steering score" />}
          caption={s.steering.weights(
            view.weights.judge,
            view.weights.practise,
            view.weights.thumbs,
          )}
          empty={!hasScore}
          emptyText={s.steering.empty}
        >
          <LineChart
            data={chart}
            options={lineOpts({
              leftTitle: "0–100",
              domain: [0, 100],
              colorScale: {
                [s.steering.series.score]: PALETTE.blue,
                [s.steering.series.judge]: PALETTE.teal,
                [s.steering.series.practise]: PALETTE.purple,
                [s.steering.series.thumbs]: PALETTE.orange,
              },
            })}
          />
        </ChartCard>
        {last?.steering.value != null && (
          <p className="text-sm" data-testid="steering-latest">
            {s.steering.latest(fixed(last.steering.value))}
          </p>
        )}
        {partialWeeks.length > 0 && (
          <p className="text-xs text-typography-700" data-testid="steering-partial">
            {partialWeeks
              .map(
                w =>
                  `${w.week}: ${s.steering.partial(w.steering.missing.map(m => s.steering.parts[m]).join(", "))}`,
              )
              .join(" · ")}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2" data-testid="metrics-uptake">
        <h3 className="flex items-center gap-1 text-xl font-normal text-typography-900">
          {s.uptake.heading}
          <InfoTip label={s.uptake.help} ariaLabel="About uptake lift" />
        </h3>
        <ul className="flex flex-col gap-1 text-sm">
          {view.uptake.map(u => (
            <li key={u.month} data-testid={`uptake-${u.month}`}>
              <span className="inline-block w-20 font-semibold">{u.month}</span>
              {u.insufficient
                ? s.uptake.insufficient(u.pairs)
                : s.uptake.lift(fixed(u.lift, 2), fixed(u.lower, 2), fixed(u.upper, 2), u.pairs)}
            </li>
          ))}
        </ul>
      </section>

      <MetricTable
        heading={s.guardrails.heading}
        testId="metrics-guardrails"
        rows={[
          {
            label: s.guardrails.judgeP50,
            target: "≥ 8",
            latest: fixed(g?.judgeP50),
            whole: "",
            state: targetState(g?.judgeP50 ?? null, { atLeast: 8 }, g?.judged),
          },
          {
            label: s.guardrails.hardFailRate,
            target: s.guardrails.legacy(pct(view.baselines.legacyHardFailRate)),
            latest: pct(g?.hardFailRate),
            whole: pct(windowHardFail),
            state: targetState(
              windowHardFail.value,
              legacyHf == null ? {} : { atMost: legacyHf },
              windowHardFail.of,
            ),
          },
          {
            label: s.guardrails.fabricated,
            target: "0",
            latest: String(g?.fabricatedQuotes ?? 0),
            whole: String(fabricated),
            state: fabricated > 0 ? "missed" : series.some(w => w.debriefs) ? "met" : "no_data",
          },
          {
            label: s.guardrails.thumbsDown,
            target: s.guardrails.preLaunch(pct(view.baselines.legacyThumbsDownRate)),
            latest: pct(g?.thumbsDownRate),
            whole: pct(windowThumbsDown),
            state: targetState(
              windowThumbsDown.value,
              preThumbs == null ? {} : { atMost: preThumbs },
              windowThumbsDown.of,
            ),
          },
          {
            label: s.guardrails.visible,
            target: "≤ 75 s / ≤ 120 s",
            latest: `${fixed(g?.visibleSecondsP50, 0)} s / ${fixed(g?.visibleSecondsP90, 0)} s`,
            whole: "",
            state:
              g?.visibleSecondsP50 == null
                ? "no_data"
                : g.visibleSecondsP50 <= 75 && (g.visibleSecondsP90 ?? 0) <= 120
                  ? "met"
                  : "missed",
          },
          {
            label: s.guardrails.cost,
            target: "≤ $0.20 median",
            latest: `${g?.costP50 == null ? s.none : formatUsd(g.costP50)} / ${g?.costP90 == null ? s.none : formatUsd(g.costP90)}`,
            whole: "",
            state: targetState(g?.costP50 ?? null, { atMost: 0.2 }),
          },
          {
            label: s.guardrails.gap,
            target: "≤ 0.5",
            latest: fixed(g?.evaluatorJudgeGap, 2),
            whole: "",
            state:
              g?.evaluatorJudgeGap == null
                ? "no_data"
                : Math.abs(g.evaluatorJudgeGap) <= 0.5
                  ? "met"
                  : "missed",
          },
          {
            label: s.guardrails.safety,
            target: "100% × 3",
            latest: s.guardrails.safetyNote,
            whole: "",
            state: "no_data",
          },
        ]}
      />

      <MetricTable
        heading={s.efficiency.heading}
        testId="metrics-efficiency"
        rows={[
          {
            label: s.efficiency.saved,
            target: s.experience.noTarget,
            latest:
              last?.efficiency.savedUsdMean == null
                ? s.none
                : formatUsd(last.efficiency.savedUsdMean),
            whole: "",
          },
          {
            label: s.efficiency.revisions,
            target: "≤ 1",
            latest: fixed(last?.efficiency.revisionRoundsP50, 0),
            whole: "",
            state: targetState(last?.efficiency.revisionRoundsP50 ?? null, { atMost: 1 }),
          },
          {
            label: s.efficiency.steps,
            target: s.experience.noTarget,
            latest: fixed(last?.efficiency.stepsP50, 0),
            whole: "",
          },
          {
            label: s.efficiency.within10,
            target: "≥ 99%",
            latest: pct(last?.efficiency.within10Min),
            whole: pct(sumRates(series.map(w => w.efficiency.within10Min))),
            state: (() => {
              const r = sumRates(series.map(w => w.efficiency.within10Min));
              return targetState(r.value, { atLeast: 0.99 }, r.of);
            })(),
          },
        ]}
      />

      <section className="flex flex-col gap-2">
        <MetricTable
          heading={s.experience.heading}
          help={s.experience.help}
          testId="metrics-experience"
          rows={experienceRows.map(r => {
            const whole = window(r.pick);
            return {
              label: r.label,
              target: r.targetLabel,
              latest: last ? pct(r.pick(last.experience)) : s.none,
              whole: `${pct(whole)} (${s.count(whole.n, whole.of)})`,
              state: r.target ? targetState(whole.value, r.target, whole.of) : undefined,
            };
          })}
        />
        <Breakdown
          title={s.experience.byLanguage}
          rows={view.byLanguage}
          testId="metrics-by-language"
        />
        <Breakdown
          title={s.experience.byDevice}
          rows={view.byPlatform}
          testId="metrics-by-device"
        />
      </section>
    </div>
  );
};

const MetricTable: React.FC<{
  heading: string;
  help?: string;
  testId: string;
  rows: Array<{ label: string; target: string; latest: string; whole: string; state?: State }>;
}> = ({ heading, help, testId, rows }) => {
  const c = en.debriefs.metrics.columns;
  return (
    <section className="flex flex-col gap-2" data-testid={testId}>
      <h3 className="flex items-center gap-1 text-xl font-normal text-typography-900">
        {heading}
        {help && <InfoTip label={help} ariaLabel={`About ${heading}`} />}
      </h3>
      <table className="w-full text-left text-sm">
        <thead className="text-typography-700">
          <tr>
            <th className="w-1/3 py-1 font-normal">{c.metric}</th>
            <th className="py-1 font-normal">{c.target}</th>
            <th className="py-1 font-normal">{c.latest}</th>
            <th className="py-1 font-normal">{c.window}</th>
            <th className="py-1 font-normal">{c.state}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.label} className="border-t border-gray-200 align-top">
              <td className="py-2 pr-2">{r.label}</td>
              <td className="py-2 pr-2 text-typography-700">{r.target}</td>
              <td className="py-2 pr-2">{r.latest}</td>
              <td className="py-2 pr-2">{r.whole}</td>
              <td className="py-2">{r.state && <StateCell state={r.state} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
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

const pctNum = (x: number) => `${Math.round(x * 1000) / 10}%`;

/** "87% (95% range 80–92%, 104 of 120)", or "—" with nothing counted. */
const rateWithRange = (r: DebriefRate | null | undefined): string => {
  const s = en.debriefs.metrics.quality;
  if (!r || r.value == null) return en.debriefs.metrics.none;
  const ci = r.low != null && r.high != null ? { low: r.low, high: r.high } : wilson(r.n, r.of);
  const range = ci.low != null && ci.high != null ? s.range(pctNum(ci.low), pctNum(ci.high)) : "";
  return `${pctNum(r.value)} (${[range, s.of(r.n, r.of)].filter(Boolean).join(", ")})`;
};

/**
 * The pass rate (same definition as the test-set evals) by week, by language,
 * and by language × writing model × judge version, beside the PRD metrics.
 */
const QualitySection: React.FC<{ quality: DebriefMetricsView["quality"] }> = ({ quality }) => {
  const s = en.debriefs.metrics.quality;
  const c = s.cols;
  if (!quality) return null;
  const weeks = quality.byWeek;
  const total = (pick: (g: DebriefPassGroup) => DebriefRate): DebriefRate => {
    const n = weeks.reduce((a, w) => a + pick(w).n, 0);
    const of = weeks.reduce((a, w) => a + pick(w).of, 0);
    return { n, of, value: of > 0 ? n / of : null, ...wilson(n, of) };
  };
  const outages = weeks.reduce((a, w) => a + w.outages, 0);
  const unjudged = weeks.reduce((a, w) => a + w.unjudged, 0);
  const th = "py-1 pr-2 font-normal";
  const td = "py-1 pr-2";
  return (
    <section className="flex flex-col gap-3" data-testid="metrics-quality">
      <h3 className="flex items-center gap-1 text-xl font-normal text-typography-900">
        {s.heading}
        <InfoTip label={s.help} ariaLabel={`About ${s.heading}`} />
      </h3>
      {weeks.length === 0 ? (
        <p className="text-sm text-typography-700">{s.empty}</p>
      ) : (
        <>
          <p className="text-2xl text-typography-900" data-testid="metrics-quality-headline">
            {rateWithRange(total(g => g.passRate))}
          </p>
          <p className="text-sm text-typography-700">
            {s.outages}: {outages} · {s.unjudged}: {unjudged}
          </p>
          <QualityTable
            title={s.byWeek}
            testId="metrics-quality-weeks"
            head={[c.week, c.passRate, c.hardFailRate, c.judgeMean]}
            rows={weeks.map(w => [
              w.week,
              rateWithRange(w.passRate),
              rateWithRange(w.hardFailRate),
              fixed(w.judgeMean, 2),
            ])}
            th={th}
            td={td}
          />
          <QualityTable
            title={s.byLanguage}
            testId="metrics-quality-languages"
            head={[c.language, c.debriefs, c.passRate, c.hardFailRate, c.judgeMean]}
            rows={quality.byLanguage.map(l => [
              l.language,
              String(l.debriefs),
              rateWithRange(l.passRate),
              rateWithRange(l.hardFailRate),
              fixed(l.judgeMean, 2),
            ])}
            th={th}
            td={td}
          />
          <QualityTable
            title={s.bySegment}
            help={s.segmentHelp}
            testId="metrics-quality-segments"
            head={[c.language, c.writerModel, c.judgeVersion, c.debriefs, c.passRate]}
            rows={quality.bySegment.map(g => [
              g.language,
              g.writerModel,
              g.judgeVersion,
              String(g.debriefs),
              rateWithRange(g.passRate),
            ])}
            th={th}
            td={td}
          />
          {quality.breakdowns && <Breakdowns b={quality.breakdowns} th={th} td={td} />}
        </>
      )}
    </section>
  );
};

/** Live numbers for every agent in the debrief family, one row per measure. */
const AgentsSection: React.FC<{ agents: DebriefMetricsView["agents"] }> = ({ agents }) => {
  const s = en.debriefs.metrics.agents;
  if (!agents) return null;
  const { stages: st, askAlly, pmAgent } = agents;
  const r = rateWithRange;
  const time = (h: { msP50: number | null; msP90: number | null }) =>
    h.msP50 == null || h.msP90 == null
      ? en.debriefs.metrics.none
      : s.time(s.seconds(h.msP50), s.seconds(h.msP90));
  const rows: string[][] = [
    [s.safetyReader.name, s.safetyReader.fail, r(st.safetyReader.failRate)],
    [s.safetyReader.name, s.safetyReader.retry, r(st.safetyReader.retryRate)],
    [s.safetyReader.name, s.safetyReader.time, time(st.safetyReader)],
    [s.safetyReader.name, s.safetyReader.riskCue, r(st.safetyReader.riskCueRate)],
    [
      s.safetyReader.name,
      s.safetyReader.missDespiteCoverage,
      r(st.safetyReader.judgeMissDespiteCoverage),
    ],
    [s.analyst.name, s.analyst.fail, r(st.analyst.failRate)],
    [s.analyst.name, s.analyst.time, time(st.analyst)],
    [s.progressReader.name, s.progressReader.fail, r(st.progressReader.failRate)],
    [
      s.progressReader.name,
      s.progressReader.unsupported,
      r(st.progressReader.unsupportedProgressRate),
    ],
    [s.guidance.name, s.guidance.found, r(st.guidanceLookup.foundRate)],
    [s.guidance.name, s.guidance.perRun, fixed(st.guidanceLookup.passagesPerRunMean)],
    [s.guidance.name, s.guidance.clinicalNoRisk, r(st.guidanceLookup.clinicalOnNoRiskRate)],
    [s.guidance.name, s.guidance.wrongLevel, r(st.guidanceLookup.wrongLevelRate)],
    [s.writer.name, s.writer.firstDraft, r(st.writer.firstDraftPassRate)],
    [
      s.writer.name,
      s.writer.failures,
      st.writer.firstDraftFailures.length
        ? st.writer.firstDraftFailures
            .slice(0, 4)
            .map(f => `${f.code} (${f.runs})`)
            .join(", ")
        : en.debriefs.metrics.none,
    ],
    [s.writer.name, s.writer.fail, r(st.writer.failRate)],
    [s.reviser.name, s.reviser.fix, r(st.reviser.fixRate)],
    [s.reviser.name, s.reviser.regression, r(st.reviser.regressionRate)],
    [s.reviser.name, s.reviser.deadline, r(st.reviser.deadlineSkipRate)],
    [s.evaluator.name, s.evaluator.kappa, fixed(st.evaluator.missedRiskCue.kappa, 2)],
    [s.evaluator.name, s.evaluator.recall, r(st.evaluator.missedRiskCue.recall)],
    [s.evaluator.name, s.evaluator.falseFlag, r(st.evaluator.missedRiskCue.falseFlagRate)],
    [s.evaluator.name, s.evaluator.held, r(st.evaluator.heldOnItsOwnRate)],
    [s.judge.name, s.judge.judged, r(st.judge.judgedRate)],
    [s.judge.name, s.judge.versions, st.judge.versions.join(", ") || en.debriefs.metrics.none],
    [s.askAlly.name, s.askAlly.replies, String(askAlly.replies)],
    [s.askAlly.name, s.askAlly.checks, r(askAlly.checkPassRate)],
    [s.askAlly.name, s.askAlly.pass, askAlly.passRate ? r(askAlly.passRate) : s.notMeasured],
    [s.askAlly.name, s.askAlly.distress, String(askAlly.distressFlags)],
    [s.pmAgent.name, s.pmAgent.ideas, String(pmAgent.ideas)],
    [s.pmAgent.name, s.pmAgent.tested, `${pmAgent.screened} / ${pmAgent.gated}`],
    [
      s.pmAgent.name,
      s.pmAgent.outcome,
      `${pmAgent.promoted} / ${pmAgent.reverted} / ${pmAgent.rejected} / ${pmAgent.pending}`,
    ],
    [s.pmAgent.name, s.pmAgent.held, r(pmAgent.holdRate)],
  ];
  return (
    <section className="flex flex-col gap-2" data-testid="metrics-agents">
      <h3 className="flex items-center gap-1 text-xl font-normal text-typography-900">
        {s.heading}
        <InfoTip label={s.help} ariaLabel={`About ${s.heading}`} />
      </h3>
      <QualityTable
        title=""
        testId="metrics-agents-table"
        head={[s.cols.agent, s.cols.measure, s.cols.value]}
        rows={rows}
        th="py-1 pr-2 font-normal"
        td="py-1 pr-2 align-top"
      />
    </section>
  );
};

/**
 * The six filters, applied to every live metric on the page. Only values that
 * exist in the window are offered; an empty choice means "all".
 */
const FilterBar: React.FC<{
  options: DebriefFilterOptions | undefined;
  filter: DebriefMetricsFilter;
  onFilter: (f: DebriefMetricsFilter) => void;
}> = ({ options, filter, onFilter }) => {
  const s = en.debriefs.metrics.filters;
  if (!options) return null;
  const set = (patch: Partial<DebriefMetricsFilter>) => onFilter({ ...filter, ...patch });
  const pick = (
    id: string,
    label: string,
    value: string | number | undefined,
    choices: Array<{ value: string; label: string }>,
    onChange: (v: string) => void,
  ) => (
    <label className="flex flex-col gap-1 text-sm" key={id}>
      <span className="text-typography-700">{label}</span>
      <select
        aria-label={label}
        data-testid={`metrics-filter-${id}`}
        className="rounded border border-gray-300 px-2 py-1"
        value={value === undefined ? "" : String(value)}
        onChange={e => onChange(e.target.value)}
      >
        <option value="">{s.all}</option>
        {choices.map(c => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
  );
  const active = Object.values(filter).some(v => v !== undefined && v !== "");
  return (
    <section className="flex flex-col gap-2" data-testid="metrics-filters">
      <h3 className="flex items-center gap-1 text-base font-semibold text-typography-900">
        {s.heading}
        <InfoTip label={s.help} ariaLabel={`About ${s.heading}`} />
      </h3>
      <div className="flex flex-wrap items-end gap-4">
        {pick(
          "organisation",
          s.organisation,
          filter.tenantId,
          options.organisations.map(o => ({ value: o.id, label: o.name })),
          v => set({ tenantId: v || undefined }),
        )}
        {pick(
          "language",
          s.language,
          filter.language,
          options.languages.map(l => ({ value: l, label: l })),
          v => set({ language: v || undefined }),
        )}
        {pick(
          "learnerLevel",
          s.learnerLevel,
          filter.learnerLevel,
          options.learnerLevels.map(l => ({ value: l, label: s.levels[l] ?? l })),
          v => set({ learnerLevel: v || undefined }),
        )}
        {pick(
          "recipe",
          s.recipe,
          filter.recipe,
          options.recipes.map(r => ({ value: r, label: s.recipes[r] ?? r })),
          v => set({ recipe: v || undefined }),
        )}
        {pick(
          "releaseVersion",
          s.releaseVersion,
          filter.releaseVersion,
          options.releaseVersions.map(v => ({ value: String(v), label: s.release(v) })),
          v => set({ releaseVersion: v ? Number(v) : undefined }),
        )}
        {pick(
          "judgeVersion",
          s.judgeVersion,
          filter.judgeVersion,
          options.judgeVersions.map(v => ({ value: v, label: v })),
          v => set({ judgeVersion: v || undefined }),
        )}
        {active && (
          <button
            type="button"
            className="text-sm text-blue-700 underline"
            data-testid="metrics-filter-clear"
            onClick={() => onFilter({})}
          >
            {s.clear}
          </button>
        )}
      </div>
      {active && <p className="text-sm text-typography-700">{s.unfilteredNote}</p>}
    </section>
  );
};

/** The pass rate broken down by skill, scenario, course, session length, step model and risk. */
const Breakdowns: React.FC<{
  b: NonNullable<NonNullable<DebriefMetricsView["quality"]>["breakdowns"]>;
  th: string;
  td: string;
}> = ({ b, th, td }) => {
  const s = en.debriefs.metrics.quality;
  const c = s.cols;
  const k = s.breakdowns;
  const rows = (list: DebriefPassBreakdownRow[]) =>
    list.map(r => [
      r.key,
      String(r.debriefs),
      rateWithRange(r.passRate),
      rateWithRange(r.hardFailRate),
      fixed(r.judgeMean, 2),
    ]);
  const head = [k.key, c.debriefs, c.passRate, c.hardFailRate, c.judgeMean];
  const tables: Array<{
    id: string;
    title: string;
    help?: string;
    list: DebriefPassBreakdownRow[];
  }> = [
    { id: "skill", title: k.skill, help: k.skillHelp, list: b.skill },
    { id: "scenario", title: k.scenario, list: b.scenario },
    { id: "course", title: k.course, help: k.courseHelp, list: b.course },
    { id: "session-length", title: k.sessionLength, list: b.sessionLength },
    { id: "step-model", title: k.stepModel, help: k.stepModelHelp, list: b.stepModel },
    { id: "risk", title: k.risk, list: b.risk },
  ];
  return (
    <div className="flex flex-col gap-3" data-testid="metrics-quality-breakdowns">
      <h4 className="text-base font-semibold text-typography-900">{k.heading}</h4>
      {tables
        .filter(t => t.list.length > 0)
        .map(t => (
          <QualityTable
            key={t.id}
            title={t.title}
            help={t.help}
            testId={`metrics-breakdown-${t.id}`}
            head={head}
            rows={rows(t.list)}
            th={th}
            td={td}
          />
        ))}
    </div>
  );
};

const QualityTable: React.FC<{
  title: string;
  help?: string;
  testId: string;
  head: string[];
  rows: string[][];
  th: string;
  td: string;
}> = ({ title, help, testId, head, rows, th, td }) => (
  <div className="flex flex-col gap-1" data-testid={testId}>
    {title && (
      <h4 className="flex items-center gap-1 text-base font-semibold text-typography-900">
        {title}
        {help && <InfoTip label={help} ariaLabel={`About ${title}`} />}
      </h4>
    )}
    <table className="w-full text-left text-sm">
      <thead className="text-typography-700">
        <tr>
          {head.map(h => (
            <th key={h} className={th}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.join("|")} className="border-t border-gray-200">
            {r.map((cell, i) => (
              <td key={i} className={td}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const BREAKDOWN_KEYS: Array<keyof DebriefExperienceRates> = [
  "openedWithin24h",
  "readThrough",
  "practiseClickThrough",
  "reflectionAnswered",
  "abandonedBeforeReady",
];

const Breakdown: React.FC<{
  title: string;
  testId: string;
  rows: DebriefMetricsView["byLanguage"];
}> = ({ title, testId, rows }) => {
  const s = en.debriefs.metrics.experience;
  if (!rows.length) return null;
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <h4 className="text-base font-semibold text-typography-900">{title}</h4>
      <table className="w-full text-left text-sm">
        <thead className="text-typography-700">
          <tr>
            <th className="py-1 font-normal" />
            {BREAKDOWN_KEYS.map(k => (
              <th key={k} className="py-1 font-normal">
                {s[k] as string}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key} className="border-t border-gray-200">
              <td className="py-1 pr-2 font-semibold">{r.key}</td>
              {BREAKDOWN_KEYS.map(k => (
                <td
                  key={k}
                  className="py-1 pr-2"
                  title={`${r.experience[k].n} of ${r.experience[k].of}`}
                >
                  {pct(r.experience[k])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
