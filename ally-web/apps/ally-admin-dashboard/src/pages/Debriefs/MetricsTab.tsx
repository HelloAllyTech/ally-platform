import React, { useMemo, useState } from "react";

import "@carbon/charts/styles.css";
import "../Analytics/analytics-carbon.scss";

import { CarbonDropdown as Dropdown } from "@ally-ui-mono/ui-shared";
import { useGetDebriefMetricsQuery } from "@api";
import { formatUsd } from "@components/ally-guide/allyGuideFormat";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { AreaChart, LineChart } from "@components/charts";
import { en } from "@constants";
import {
  AnalyticsRange,
  DebriefExperienceRates,
  DebriefFilterOptions,
  DebriefMetricsFilter,
  DebriefMetricsView,
  DebriefPassBreakdownRow,
  DebriefPassGroup,
  DebriefPassRateSegment,
  DebriefRate,
  DebriefSafetyRecallRun,
} from "@types";

import { languageLabel } from "./consoleLabels";
import { FilterChip, FilterChips, MoreFiltersButton } from "./consoleRows";
import { ChangeWhiskers, WhiskerRow } from "../Analytics/ChangeWhiskers";
import { ChartCard, KpiTile, lineOpts, PALETTE } from "../Analytics/chartKit";
import { CONTEXT, stableScale } from "../Analytics/chartScales";
import { TabControls } from "../Analytics/tabControlsSlot";
import { AgentsSection } from "./metrics/AgentsSection";
import { BulletRow, BulletRows, NumbersTable, RateDots, RateRow } from "./metrics/metricsCharts";
import {
  MIN_RATE_SAMPLE,
  Target,
  hasLiveDebriefs,
  headlineNumbers,
  isThin,
  niceCeiling,
  pctNum,
  rangeOf,
  rateBand,
  rateWithRange,
  sumRates,
  targetState,
  wilson,
} from "./metrics/metricsData";

export { MIN_RATE_SAMPLE, rateWithRange, targetState, wilson };
export { orchestratorRows } from "./metrics/AgentsSection";

/**
 * The page's time range, in the weeks the metrics endpoint reads. Rounded up so the window always
 * covers the range the picker names.
 */
const WEEKS_FOR_RANGE: Record<AnalyticsRange, number> = { "30d": 5, "90d": 13, "12m": 52, all: 52 };

const pct = (r: DebriefRate | null | undefined) =>
  r?.value == null ? en.debriefs.metrics.none : pctNum(r.value);
const fixed = (x: number | null | undefined, d = 1) =>
  x == null ? en.debriefs.metrics.none : x.toFixed(d);

/** The debrief's success metrics (v9 §3.3, PRD §4), for switched-on organisations. */
export const MetricsTab: React.FC<{ range?: AnalyticsRange }> = ({ range = "90d" }) => {
  const s = en.debriefs.metrics;
  const weeks = WEEKS_FOR_RANGE[range];
  const [filter, setFilter] = useState<DebriefMetricsFilter>({});
  // Pass-rate segments live under the Pass rate heading and narrow only that section (the backend
  // applies them to the pass rate alone).
  const [segment, setSegment] = useState<DebriefPassRateSegment>({});
  const q = useGetDebriefMetricsQuery({ weeks, ...filter, ...segment });

  if (q.isError && !q.data) {
    return (
      <div data-testid="debrief-metrics-tab">
        <ChartCard
          title={s.heading}
          error
          errorTitle={s.sections.loadFailedTitle}
          errorSubtitle={s.sections.loadFailedSubtitle}
          onRetry={() => void q.refetch()}
        />
      </div>
    );
  }
  if (!q.data) return <MetricsSkeleton />;
  return (
    // RTK Query keeps the last answer while a new filter loads: hold it, dimmed, rather than flash.
    <div
      className={q.isFetching ? "opacity-60 transition-opacity" : "transition-opacity"}
      aria-busy={q.isFetching || undefined}
    >
      <MetricsBody
        view={q.data}
        filter={filter}
        onFilter={setFilter}
        segment={segment}
        onSegment={setSegment}
      />
    </div>
  );
};

/** A trend of counts that never left zero says nothing: no sparkline. */
const someCount = (xs: number[]) => (xs.some(x => x > 0) ? xs : undefined);

const TILE_GRID = "grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6";

const MetricsSkeleton: React.FC = () => {
  const t = en.debriefs.metrics.tiles;
  return (
    <div className="flex flex-col gap-6" data-testid="debrief-metrics-loading">
      <div className={TILE_GRID}>
        {[t.pass, t.hardFail, t.judge, t.debriefs, t.outages, t.unjudged].map(l => (
          <KpiTile key={l} label={l} value="" loading />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ChartCard title={en.debriefs.metrics.sections.passByWeek} loading />
        <ChartCard title={en.debriefs.metrics.sections.hardFailByWeek} loading />
      </div>
    </div>
  );
};

const SectionHeading: React.FC<{ title: string; help?: string }> = ({ title, help }) => (
  <h3 className="flex items-center gap-1 text-xl font-normal text-typography-900">
    {title}
    {help && <InfoTip label={help} ariaLabel={`About ${title}`} />}
  </h3>
);

const MetricsBody: React.FC<{
  view: DebriefMetricsView;
  filter: DebriefMetricsFilter;
  onFilter: (f: DebriefMetricsFilter) => void;
  segment: DebriefPassRateSegment;
  onSegment: (s: DebriefPassRateSegment) => void;
}> = ({ view, filter, onFilter, segment, onSegment }) => {
  const s = en.debriefs.metrics;
  const live = hasLiveDebriefs(view);
  const filtered = Object.values(filter).some(v => v !== undefined && v !== "");
  return (
    <div className="flex flex-col gap-8" data-testid="debrief-metrics-tab">
      <div className="flex flex-col gap-1">
        <p className="max-w-3xl text-sm text-typography-700">{s.help}</p>
        {filtered && (
          <p
            className="max-w-3xl text-sm text-typography-700"
            data-testid="metrics-unfiltered-note"
          >
            {s.filters.unfilteredNote}
          </p>
        )}
      </div>
      <FilterBar options={view.filterOptions} filter={filter} onFilter={onFilter} />
      <HeadlineTiles view={view} />
      {/* The north star sits under the tiles: it is the measure the debrief exists to move. */}
      <UptakeCard uptake={view.uptake} />

      {!live ? (
        <div
          className="flex flex-col items-center justify-center gap-1 rounded border border-dashed border-border-light px-4 py-12 text-center"
          data-testid="metrics-no-live"
        >
          <p className="text-sm font-medium text-typography-700">{s.sections.noLive}</p>
          <p className="max-w-xl text-xs text-typography-500">
            {filtered ? s.sections.noLiveFiltered : s.sections.noLiveHelp}
          </p>
        </div>
      ) : (
        <>
          <QualitySection
            quality={view.quality}
            options={view.filterOptions}
            segment={segment}
            onSegment={onSegment}
          />
          <SteeringCard view={view} />
          <GuardrailsCard view={view} />
          <ExperienceSection view={view} />
          <EfficiencyCard view={view} />
        </>
      )}
      <AgentsSection agents={view.agents} />
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Headline tiles                                                             */
/* -------------------------------------------------------------------------- */

const HeadlineTiles: React.FC<{ view: DebriefMetricsView }> = ({ view }) => {
  const t = en.debriefs.metrics.tiles;
  const h = useMemo(() => headlineNumbers(view), [view]);
  const ci = rangeOf(h.pass);
  return (
    <div className={TILE_GRID} data-testid="metrics-tiles">
      <KpiTile
        label={t.pass}
        value={h.pass.value == null ? en.debriefs.metrics.none : pctNum(h.pass.value)}
        n={h.pass.of}
        nUnit={t.debriefsUnit}
        minN={MIN_RATE_SAMPLE}
        delta={h.delta.pass}
        deltaSuffix=" pts"
        comparisonLabel={t.vsWeek}
        spark={h.spark.pass}
        description={
          ci.low != null && ci.high != null
            ? t.passHelp(pctNum(ci.low), pctNum(ci.high), h.pass.n, h.pass.of)
            : undefined
        }
      />
      <KpiTile
        label={t.hardFail}
        value={h.hardFail.value == null ? en.debriefs.metrics.none : pctNum(h.hardFail.value)}
        n={h.hardFail.of}
        nUnit={t.debriefsUnit}
        minN={MIN_RATE_SAMPLE}
        delta={h.delta.hardFail}
        deltaSuffix=" pts"
        higherIsBetter={false}
        comparisonLabel={t.vsWeek}
        spark={h.spark.hardFail}
        description={h.hardFail.of ? t.hardFailHelp(h.hardFail.n, h.hardFail.of) : undefined}
      />
      <KpiTile
        label={t.judge}
        value={fixed(h.judgeMean, 2)}
        n={h.judged}
        nUnit={t.judgedUnit}
        minN={MIN_RATE_SAMPLE}
        delta={h.delta.judge}
        deltaDecimals={2}
        comparisonLabel={t.vsWeek}
        spark={h.spark.judge}
        description={t.judgeHelp(h.judged)}
      />
      <KpiTile
        label={t.debriefs}
        value={h.debriefs.toLocaleString()}
        spark={someCount(h.spark.debriefs)}
        description={t.debriefsHelp}
      />
      <KpiTile
        label={t.outages}
        value={h.outages.toLocaleString()}
        spark={someCount(h.spark.outages)}
        description={t.outagesHelp}
      />
      <KpiTile
        label={t.unjudged}
        value={h.unjudged.toLocaleString()}
        spark={someCount(h.spark.unjudged)}
        description={t.unjudgedHelp}
      />
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Pass rate                                                                  */
/* -------------------------------------------------------------------------- */

const bandChartOpts = (title: string, color: string, domain: [number, number]) =>
  lineOpts({
    leftTitle: `${title} (%)`,
    colorScale: { [title]: color },
    domain,
    legend: false,
    extra: {
      bounds: { upperBoundMapsTo: "max", lowerBoundMapsTo: "min" },
      points: { enabled: true, radius: 4 },
      tooltip: {
        valueFormatter: (v: unknown) => (typeof v === "number" ? `${v}%` : "—"),
      },
    },
  });

/**
 * A breakdown group's name as people read it. Step-model groups arrive as "<step>: <model>", so the
 * step id becomes the step's name from the run view; lower-case groups ("risk cue") get a capital.
 */
export const groupLabel = (key: string): string => {
  const at = key.indexOf(": ");
  if (at > 0) {
    const step = key.slice(0, at);
    const name = en.debriefs.run.stepNames[step];
    if (name) return `${name}: ${key.slice(at + 2)}`;
  }
  return /^[a-z]/.test(key) && !/[-_]/.test(key) ? key.charAt(0).toUpperCase() + key.slice(1) : key;
};

const groupRows = (
  list: DebriefPassBreakdownRow[],
  label: (key: string) => string = groupLabel,
): RateRow[] => {
  return list.map(r => ({
    key: r.key,
    label: label(r.key),
    rate: r.passRate,
    extra: en.debriefs.metrics.sections.groupExtra(pct(r.hardFailRate), fixed(r.judgeMean, 1)),
  }));
};

const groupTable = (
  list: DebriefPassBreakdownRow[],
  label: (key: string) => string = groupLabel,
): string[][] =>
  list.map(r => [
    label(r.key),
    String(r.debriefs),
    rateWithRange(r.passRate),
    rateWithRange(r.hardFailRate),
    fixed(r.judgeMean, 2),
  ]);

/**
 * The pass rate (same definition as the test-set evals): by week as a line with
 * its 95% band, then every breakdown as dot-and-whisker rows.
 */
const QualitySection: React.FC<{
  quality: DebriefMetricsView["quality"];
  options: DebriefFilterOptions | undefined;
  segment: DebriefPassRateSegment;
  onSegment: (s: DebriefPassRateSegment) => void;
}> = ({ quality, options, segment, onSegment }) => {
  const s = en.debriefs.metrics.quality;
  const sec = en.debriefs.metrics.sections;
  const c = s.cols;
  const weeks = useMemo(() => quality?.byWeek ?? [], [quality]);
  const passBand = useMemo(
    () =>
      rateBand(
        c.passRate,
        weeks.map(w => ({ week: w.week, rate: w.passRate })),
      ),
    [weeks, c.passRate],
  );
  const hardBand = useMemo(
    () =>
      rateBand(
        c.hardFailRate,
        weeks.map(w => ({ week: w.week, rate: w.hardFailRate })),
      ),
    [weeks, c.hardFailRate],
  );
  if (!quality) return null;
  const thinWeeks = weeks.filter(w => w.passRate.of > 0 && w.passRate.of < MIN_RATE_SAMPLE);
  const hardMax =
    niceCeiling(weeks.map(w => rangeOf(w.hardFailRate).high ?? w.hardFailRate.value ?? 0)) * 100;
  const total = (pick: (g: DebriefPassGroup) => DebriefRate) => sumRates(weeks.map(pick));

  const languageRows: DebriefPassBreakdownRow[] = quality.byLanguage.map(l => ({
    ...l,
    key: l.language,
  }));
  const segmented = Object.values(segment).some(v => v !== undefined && v !== "");

  return (
    <section className="flex flex-col gap-4" data-testid="metrics-quality">
      <SectionHeading title={s.heading} help={s.help} />
      <SegmentBar options={options} segment={segment} onSegment={onSegment} />
      {weeks.length === 0 ? (
        <p className="text-sm text-typography-700" data-testid="metrics-quality-empty">
          {segmented ? s.segments.noMatch : s.empty}
        </p>
      ) : (
        <>
          <p className="sr-only" data-testid="metrics-quality-headline">
            {rateWithRange(total(g => g.passRate))}
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <ChartCard
              title={sec.passByWeek}
              caption={sec.passByWeekCaption}
              source={
                thinWeeks.length ? sec.thinWeeks(thinWeeks.map(w => w.week).join(", ")) : undefined
              }
              empty={!passBand.some(p => p.value != null)}
              emptyText={s.empty}
            >
              <div data-testid="metrics-pass-by-week">
                <AreaChart
                  data={passBand}
                  options={bandChartOpts(c.passRate, PALETTE.blue, [0, 100])}
                />
              </div>
            </ChartCard>
            <ChartCard
              title={sec.hardFailByWeek}
              caption={sec.hardFailByWeekCaption}
              empty={!hardBand.some(p => p.value != null)}
              emptyText={s.empty}
            >
              <div data-testid="metrics-hard-fail-by-week">
                <AreaChart
                  data={hardBand}
                  options={bandChartOpts(c.hardFailRate, PALETTE.orange, [0, hardMax])}
                />
              </div>
            </ChartCard>
          </div>
          <NumbersTable
            testId="metrics-quality-weeks"
            head={[c.week, c.passRate, c.hardFailRate, c.judgeMean]}
            rows={weeks.map(w => [
              w.week,
              rateWithRange(w.passRate),
              rateWithRange(w.hardFailRate),
              fixed(w.judgeMean, 2),
            ])}
          />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {languageRows.length > 0 && (
              <ChartCard title={s.byLanguage} caption={sec.breakdownsCaption}>
                <RateDots
                  rows={groupRows(languageRows, languageLabel)}
                  max={1}
                  testId="metrics-by-language-dots"
                />
                <NumbersTable
                  testId="metrics-quality-languages"
                  head={[c.language, c.debriefs, c.passRate, c.hardFailRate, c.judgeMean]}
                  rows={groupTable(languageRows, languageLabel)}
                />
              </ChartCard>
            )}
          </div>
        </>
      )}
    </section>
  );
};

/* -------------------------------------------------------------------------- */
/* Steering score                                                             */
/* -------------------------------------------------------------------------- */

const SteeringCard: React.FC<{ view: DebriefMetricsView }> = ({ view }) => {
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
  return (
    <section className="flex flex-col gap-2" data-testid="metrics-steering">
      <ChartCard
        title={s.steering.heading}
        titleHelp={<InfoTip label={s.steering.help} ariaLabel="About the steering score" />}
        caption={s.steering.weights(view.weights.judge, view.weights.practise, view.weights.thumbs)}
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
        {last?.steering.value != null && (
          <p className="mt-2 text-sm" data-testid="steering-latest">
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
      </ChartCard>
    </section>
  );
};

/* -------------------------------------------------------------------------- */
/* Guardrails, efficiency, experience: bullet charts against targets          */
/* -------------------------------------------------------------------------- */

/** Two-line value words: the main number, then a smaller second reading. */
const Words: React.FC<{ main: React.ReactNode; sub?: string }> = ({ main, sub }) => (
  <span className="flex flex-col">
    <span>{main}</span>
    {sub && <span className="text-typography-500">{sub}</span>}
  </span>
);

/** A whole-window rate as a bullet row on a 0..max % scale. */
const rateBullet = (
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

const GuardrailsCard: React.FC<{ view: DebriefMetricsView }> = ({ view }) => {
  const s = en.debriefs.metrics;
  const series = view.series;
  const g = series[series.length - 1]?.guardrails;
  const windowHardFail = sumRates(series.map(w => w.guardrails.hardFailRate));
  const windowThumbsDown = sumRates(series.map(w => w.guardrails.thumbsDownRate));
  const fabricated = series.reduce((a, w) => a + w.guardrails.fabricatedQuotes, 0);
  const legacyHf = view.baselines.legacyHardFailRate.value;
  const preThumbs = view.baselines.legacyThumbsDownRate.value;
  const p90s = g?.visibleSecondsP90 ?? 0;
  const cost90 = g?.costP90 ?? 0;
  const rows: BulletRow[] = [
    {
      key: "judge-p50",
      label: s.guardrails.judgeP50,
      targetLabel: "≥ 8",
      value: g?.judgeP50 ?? null,
      targets: [8],
      max: 10,
      words: <Words main={`${fixed(g?.judgeP50)} / 10`} sub={s.columns.latest} />,
      state: targetState(g?.judgeP50 ?? null, { atLeast: 8 }, g?.judged),
    },
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
    rateBullet("thumbs-down", s.guardrails.thumbsDown, windowThumbsDown, {
      target: preThumbs == null ? {} : { atMost: preThumbs },
      targetLabel: s.guardrails.preLaunch(pct(view.baselines.legacyThumbsDownRate)),
      latest: g?.thumbsDownRate,
    }),
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

const repsLine = (r: DebriefSafetyRecallRun) =>
  r.reps.length ? r.reps.map(x => `${Math.round(x.recall * 100)}%`).join(" · ") : "—";

const safetyWhen = (r: DebriefSafetyRecallRun) => {
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
const safetyRow = (m: DebriefMetricsView["safetyRecall"] | undefined): BulletRow => {
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

const EfficiencyCard: React.FC<{ view: DebriefMetricsView }> = ({ view }) => {
  const s = en.debriefs.metrics;
  const series = view.series;
  const e = series[series.length - 1]?.efficiency;
  const within = sumRates(series.map(w => w.efficiency.within10Min));
  const saved = e?.savedUsdMean ?? null;
  const steps = e?.stepsP50 ?? null;
  const rows: BulletRow[] = [
    {
      key: "saved",
      label: s.efficiency.saved,
      value: saved,
      max: Math.max(0.5, Math.ceil((saved ?? 0) * 1.25 * 10) / 10),
      words: saved == null ? s.none : formatUsd(saved),
    },
    {
      key: "revisions",
      label: s.efficiency.revisions,
      targetLabel: "≤ 1",
      value: e?.revisionRoundsP50 ?? null,
      targets: [1],
      max: Math.max(3, e?.revisionRoundsP50 ?? 0),
      words: fixed(e?.revisionRoundsP50, 0),
      state: targetState(e?.revisionRoundsP50 ?? null, { atMost: 1 }),
    },
    {
      key: "steps",
      label: s.efficiency.steps,
      value: steps,
      max: Math.max(10, steps ?? 0),
      words: fixed(steps, 0),
    },
    rateBullet("within10", s.efficiency.within10, within, {
      target: { atLeast: 0.99 },
      targetLabel: "≥ 99%",
      latest: e?.within10Min,
      max: 1,
    }),
  ];
  return (
    <ChartCard title={s.efficiency.heading} caption={s.sections.efficiencyCaption}>
      <BulletRows rows={rows} testId="metrics-efficiency" />
    </ChartCard>
  );
};

/** A rate with nothing counted (a server from before the pulse). */
const NO_RATE: DebriefRate = { n: 0, of: 0, value: null };

const BREAKDOWN_KEYS: Array<keyof DebriefExperienceRates> = [
  "openedWithin24h",
  "readThrough",
  "practiseClickThrough",
  "reflectionAnswered",
  "abandonedBeforeReady",
];

const ExperienceSection: React.FC<{ view: DebriefMetricsView }> = ({ view }) => {
  const s = en.debriefs.metrics;
  const series = view.series;
  const last = series[series.length - 1];
  const window = (pick: (e: DebriefExperienceRates) => DebriefRate) =>
    sumRates(series.map(w => pick(w.experience)));
  const defs: Array<{
    key: string;
    label: string;
    pick: (e: DebriefExperienceRates) => DebriefRate;
    target?: Target;
    targetLabel?: string;
  }> = [
    {
      key: "opened",
      label: s.experience.openedWithin24h,
      pick: e => e.openedWithin24h,
      target: { atLeast: 0.85 },
      targetLabel: "≥ 85%",
    },
    {
      key: "read",
      label: s.experience.readThrough,
      pick: e => e.readThrough,
      target: { atLeast: 0.7 },
      targetLabel: "≥ 70%",
    },
    {
      key: "practise",
      label: s.experience.practiseClickThrough,
      pick: e => e.practiseClickThrough,
      target: { atLeast: 0.25 },
      targetLabel: "≥ 25%",
    },
    {
      key: "reflection",
      label: s.experience.reflectionAnswered,
      pick: e => e.reflectionAnswered,
      target: { atLeast: 0.15 },
      targetLabel: "≥ 15%",
    },
    {
      key: "abandoned",
      label: s.experience.abandonedBeforeReady,
      pick: e => e.abandonedBeforeReady,
      target: { atMost: 0.1 },
      targetLabel: "≤ 10%",
    },
    {
      key: "flags",
      label: s.experience.flagsWithinSla(view.flagReviewSlaHours),
      pick: e => e.flagsWithinSla,
      target: { atLeast: 0.95 },
      targetLabel: "≥ 95%",
    },
    { key: "listened", label: s.experience.listened, pick: e => e.listened },
    { key: "replied", label: s.experience.replied, pick: e => e.replied },
    // PRD §9: the post-launch pulse, asked on 1 in 10 debriefs for 8 weeks.
    {
      key: "pulseKnewNext",
      label: s.experience.pulseKnewNext,
      pick: e => e.pulseKnewNext ?? NO_RATE,
    },
    { key: "pulseFair", label: s.experience.pulseFair, pick: e => e.pulseFair ?? NO_RATE },
    {
      key: "pulseFairMoment",
      label: s.experience.pulseFairImportantMoment,
      pick: e => e.pulseFairImportantMoment ?? NO_RATE,
      target: { atLeast: 0.7 },
      targetLabel: "≥ 70%",
    },
  ];
  const rows = defs.map(d =>
    rateBullet(d.key, d.label, window(d.pick), {
      target: d.target,
      targetLabel: d.targetLabel,
      latest: last ? d.pick(last.experience) : null,
      max: 1,
    }),
  );
  return (
    <section className="flex flex-col gap-4">
      <ChartCard
        title={s.experience.heading}
        titleHelp={
          <InfoTip label={s.experience.help} ariaLabel={`About ${s.experience.heading}`} />
        }
        caption={s.sections.experienceCaption}
      >
        <BulletRows rows={rows} testId="metrics-experience" />
      </ChartCard>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ExperienceStrips
          title={s.sections.experienceByGroup(
            s.experience.byLanguage.replace(/^By /, "").toLowerCase(),
          )}
          rows={view.byLanguage}
          label={languageLabel}
          testId="metrics-by-language"
        />
        <ExperienceStrips
          title={s.sections.experienceByGroup(
            s.experience.byDevice.replace(/^By /, "").toLowerCase(),
          )}
          rows={view.byPlatform}
          testId="metrics-by-device"
        />
      </div>
    </section>
  );
};

/**
 * One row per experience measure on a 0–100% axis, one dot per group (language
 * or device) in that group's fixed colour, so groups can be compared measure by
 * measure. Thin groups are hollow.
 */
const ExperienceStrips: React.FC<{
  title: string;
  testId: string;
  rows: DebriefMetricsView["byLanguage"];
  /** How a group is named (a language code becomes its name: no raw codes). */
  label?: (key: string) => string;
}> = ({ title, testId, rows, label = key => key }) => {
  const s = en.debriefs.metrics;
  if (!rows.length) return null;
  const scale = stableScale(rows.map(r => r.key));
  return (
    <ChartCard title={title} caption={s.sections.experienceByGroupCaption}>
      <div data-testid={testId}>
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-typography-700">
          {rows.map(r => (
            <span key={r.key} className="inline-flex items-center gap-1">
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: scale[r.key] }}
              />
              {label(r.key)} <span className="text-typography-500">({r.debriefs})</span>
            </span>
          ))}
        </div>
        <div className="mb-1 grid grid-cols-1 gap-1 text-xs text-typography-500 sm:grid-cols-[minmax(9rem,14rem)_1fr] sm:gap-3">
          <span className="hidden sm:block" />
          <span className="flex justify-between tabular-nums">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </span>
        </div>
        {BREAKDOWN_KEYS.map(k => (
          <div
            key={k}
            className="grid grid-cols-1 items-center gap-1 border-t border-gray-100 py-1.5 sm:grid-cols-[minmax(9rem,14rem)_1fr] sm:gap-3"
          >
            <span className="text-xs text-typography-900">{s.experience[k] as string}</span>
            <span className="relative h-7">
              <span
                className="absolute inset-x-0 top-1/2 h-px"
                style={{ background: CONTEXT.faint }}
                aria-hidden
              />
              {rows.map((r, i) => {
                const rate = r.experience[k];
                if (rate.value == null) return null;
                const thin = isThin(rate);
                return (
                  <span
                    key={r.key}
                    title={`${label(r.key)}: ${pctNum(rate.value)} (${s.count(rate.n, rate.of)})${thin ? ` · ${s.states.thin}` : ""}`}
                    className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
                    style={{
                      // Each group on its own lane, so equal values never hide each other.
                      top: `${((i + 1) / (rows.length + 1)) * 100}%`,
                      left: `${rate.value * 100}%`,
                      background: thin ? "var(--cds-layer-01, white)" : scale[r.key],
                      borderColor: thin ? scale[r.key] : "var(--cds-layer-01, white)",
                    }}
                  />
                );
              })}
            </span>
          </div>
        ))}
        <NumbersTable
          head={["", ...BREAKDOWN_KEYS.map(k => s.experience[k] as string)]}
          rows={rows.map(r => [
            label(r.key),
            ...BREAKDOWN_KEYS.map(
              k => `${pct(r.experience[k])} (${s.count(r.experience[k].n, r.experience[k].of)})`,
            ),
          ])}
        />
      </div>
    </ChartCard>
  );
};

/* -------------------------------------------------------------------------- */
/* Uptake lift                                                                */
/* -------------------------------------------------------------------------- */

const UptakeCard: React.FC<{ uptake: DebriefMetricsView["uptake"] }> = ({ uptake }) => {
  const s = en.debriefs.metrics;
  const rows: WhiskerRow[] = uptake.map(u => {
    const ci: [number, number] | null =
      u.lower != null && u.upper != null ? [u.lower, u.upper] : null;
    return {
      key: u.month,
      label: u.month,
      sublabel: u.insufficient ? s.uptake.insufficient(u.pairs) : s.sections.pairs(u.pairs),
      change: u.insufficient ? null : u.lift,
      ci,
      n: u.pairs,
      detectable: !u.insufficient && !!ci && (ci[0] > 0 || ci[1] < 0),
    };
  });
  return (
    <section data-testid="metrics-uptake">
      <ChartCard
        title={s.uptake.heading}
        titleHelp={<InfoTip label={s.uptake.help} ariaLabel="About uptake lift" />}
        caption={s.sections.uptakeCaption}
        empty={!rows.length}
        emptyText={s.sections.uptakeEmpty}
        height="120px"
      >
        <ChangeWhiskers rows={rows} emptyLabel={s.sections.uptakeEmptyLabel} />
        <ul className="sr-only">
          {uptake.map(u => (
            <li key={u.month} data-testid={`uptake-${u.month}`}>
              {u.month}:{" "}
              {u.insufficient
                ? s.uptake.insufficient(u.pairs)
                : s.uptake.lift(fixed(u.lift, 2), fixed(u.lower, 2), fixed(u.upper, 2), u.pairs)}
            </li>
          ))}
        </ul>
      </ChartCard>
    </section>
  );
};

/* -------------------------------------------------------------------------- */
/* Filters                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The pass rate's own filters, under its heading: the segments it used to list as breakdowns.
 * They narrow only the pass rate (the backend applies them to it alone), so they sit with it
 * rather than in the page's row. Same Carbon dropdowns as the page's filters; each offers only
 * values seen in the window, and a filter with nothing to offer is left out.
 */
const SegmentBar: React.FC<{
  options: DebriefFilterOptions | undefined;
  segment: DebriefPassRateSegment;
  onSegment: (s: DebriefPassRateSegment) => void;
}> = ({ options, segment, onSegment }) => {
  const g = en.debriefs.metrics.quality.segments;
  const [moreOpen, setMoreOpen] = useState(
    () => !!(segment.sessionLength || segment.stepModel || segment.risk),
  );
  if (!options) return null;
  type Item = { id: string; label: string };
  type Def = {
    id: keyof DebriefPassRateSegment;
    label: string;
    choices: Item[];
    onChange: (v: string) => void;
    width?: string;
  };
  const set = (patch: Partial<DebriefPassRateSegment>) => onSegment({ ...segment, ...patch });
  const defs: Def[] = [
    {
      id: "skill",
      label: g.skill,
      choices: (options.skills ?? []).map(x => ({ id: x, label: x })),
      onChange: v => set({ skill: v || undefined }),
    },
    {
      id: "scenarioId",
      label: g.scenario,
      choices: (options.scenarios ?? []).map(x => ({ id: String(x.id), label: x.name })),
      onChange: v => set({ scenarioId: v ? Number(v) : undefined }),
    },
    {
      id: "courseId",
      label: g.course,
      choices: (options.courses ?? []).map(x => ({ id: String(x.id), label: x.name })),
      onChange: v => set({ courseId: v ? Number(v) : undefined }),
    },
    {
      id: "sessionLength",
      label: g.sessionLength,
      choices: (options.sessionLengths ?? []).map(x => ({ id: x, label: g.length(x) })),
      onChange: v => set({ sessionLength: v || undefined }),
      width: "sm:w-48",
    },
    {
      id: "stepModel",
      label: g.stepModel,
      choices: (options.stepModels ?? []).map(x => ({ id: x, label: groupLabel(x) })),
      onChange: v => set({ stepModel: v || undefined }),
      width: "sm:w-64",
    },
    {
      id: "risk",
      label: g.risk,
      choices: (options.risks ?? []).map(x => ({ id: x, label: g.risks[x] ?? x })),
      onChange: v => set({ risk: (v || undefined) as DebriefPassRateSegment["risk"] }),
      width: "sm:w-64",
    },
  ];
  const valueOf = (d: Def) => {
    const v = segment[d.id];
    return v === undefined ? "" : String(v);
  };
  // Keep a set filter visible even if its value left the window, so it can be cleared.
  const offered = defs.filter(d => d.choices.length > 0 || valueOf(d));
  const pick = (d: Def) => {
    const items: Item[] = [{ id: "", label: g.allOf[d.id] }, ...d.choices];
    return (
      <div
        className={`w-full min-w-0 sm:shrink ${d.width ?? "sm:w-56"}`}
        key={d.id}
        data-testid={`metrics-segment-${d.id}`}
      >
        <Dropdown
          id={`debrief-pass-rate-${d.id}`}
          size="md"
          titleText={d.label}
          hideLabel
          label={d.label}
          items={items}
          selectedItem={items.find(i => i.id === valueOf(d)) ?? items[0]}
          itemToString={(item: Item | null) => item?.label ?? ""}
          onChange={({ selectedItem }: { selectedItem: Item | null }) =>
            d.onChange(selectedItem?.id ?? "")
          }
        />
      </div>
    );
  };
  // Skill, scenario and course stay in the row; the rest sit behind More filters.
  const main = offered.filter(d => ["skill", "scenarioId", "courseId"].includes(d.id));
  const more = offered.filter(d => !main.includes(d));
  const chips: FilterChip[] = offered
    .filter(d => valueOf(d))
    .map(d => ({
      id: d.id,
      label: `${d.label}: ${d.choices.find(c => c.id === valueOf(d))?.label ?? valueOf(d)}`,
      onRemove: () => {
        const next = { ...segment };
        delete next[d.id];
        onSegment(next);
      },
    }));
  return (
    <div className="flex flex-col gap-2" data-testid="metrics-segments">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-nowrap sm:items-end">
        {main.map(pick)}
        {more.length > 0 && (
          <MoreFiltersButton
            open={moreOpen}
            onToggle={() => setMoreOpen(o => !o)}
            active={more.filter(d => valueOf(d)).length}
            controls="metrics-segment-more"
            testId="metrics-segment-more-button"
          />
        )}
      </div>
      {moreOpen && more.length > 0 && (
        <div
          id="metrics-segment-more"
          className="flex flex-col gap-3 bg-neutral-50 p-3 sm:flex-row sm:flex-nowrap sm:items-end"
          data-testid="metrics-segment-more"
        >
          {more.map(pick)}
        </div>
      )}
      <FilterChips chips={chips} onClearAll={() => onSegment({})} testId="metrics-segment-chips" />
      {chips.length > 0 && <p className="text-xs text-typography-700">{g.note}</p>}
    </div>
  );
};

/**
 * The six filters, applied to every live metric on the page. They render into the Analytics page's
 * shared filter row (beside its time range), as Carbon dropdowns like every other tab's filters.
 * Only values that exist in the window are offered; the first item of each means "all".
 */
const FilterBar: React.FC<{
  options: DebriefFilterOptions | undefined;
  filter: DebriefMetricsFilter;
  onFilter: (f: DebriefMetricsFilter) => void;
}> = ({ options, filter, onFilter }) => {
  const s = en.debriefs.metrics.filters;
  const [moreOpen, setMoreOpen] = useState(
    () =>
      filter.learnerLevel !== undefined ||
      filter.releaseVersion !== undefined ||
      filter.judgeVersion !== undefined,
  );
  if (!options) return null;
  const set = (patch: Partial<DebriefMetricsFilter>) => onFilter({ ...filter, ...patch });
  type Item = { id: string; label: string };
  type Def = {
    id: string;
    key: keyof DebriefMetricsFilter;
    label: string;
    choices: Item[];
    onChange: (v: string) => void;
    width?: string;
  };
  const defs: Def[] = [
    {
      id: "organisation",
      key: "tenantId",
      label: s.organisation,
      choices: options.organisations.map(o => ({ id: o.id, label: o.name })),
      onChange: v => set({ tenantId: v || undefined }),
      width: "sm:w-52",
    },
    {
      id: "language",
      key: "language",
      label: s.language,
      choices: options.languages.map(l => ({ id: l, label: l })),
      onChange: v => set({ language: v || undefined }),
    },
    {
      id: "recipe",
      key: "recipe",
      label: s.recipe,
      choices: options.recipes.map(r => ({ id: r, label: s.recipes[r] ?? r })),
      onChange: v => set({ recipe: v || undefined }),
    },
    {
      id: "learnerLevel",
      key: "learnerLevel",
      label: s.learnerLevel,
      choices: options.learnerLevels.map(l => ({ id: l, label: s.levels[l] ?? l })),
      onChange: v => set({ learnerLevel: v || undefined }),
      width: "sm:w-56",
    },
    {
      id: "releaseVersion",
      key: "releaseVersion",
      label: s.releaseVersion,
      choices: options.releaseVersions.map(v => ({ id: String(v), label: s.release(v) })),
      onChange: v => set({ releaseVersion: v ? Number(v) : undefined }),
      width: "sm:w-40",
    },
    {
      id: "judgeVersion",
      key: "judgeVersion",
      label: s.judgeVersion,
      choices: options.judgeVersions.map(v => ({ id: v, label: v })),
      onChange: v => set({ judgeVersion: v || undefined }),
      width: "sm:w-56",
    },
  ];
  const valueOf = (d: Def) => {
    const v = filter[d.key];
    return v === undefined ? "" : String(v);
  };
  const pick = (d: Def) => {
    const items: Item[] = [{ id: "", label: s.allOf[d.id] ?? s.all }, ...d.choices];
    return (
      <div
        className={`w-full min-w-0 sm:shrink ${d.width ?? "sm:w-44"}`}
        key={d.id}
        data-testid={`metrics-filter-${d.id}`}
      >
        <Dropdown
          id={`debrief-metrics-${d.id}`}
          size="md"
          titleText={d.label}
          hideLabel
          label={d.label}
          items={items}
          selectedItem={items.find(i => i.id === valueOf(d)) ?? items[0]}
          itemToString={(item: Item | null) => item?.label ?? ""}
          onChange={({ selectedItem }: { selectedItem: Item | null }) =>
            d.onChange(selectedItem?.id ?? "")
          }
        />
      </div>
    );
  };
  // Organisation, language and debrief type sit in the page's filter row beside the time range;
  // learner level, release and judge version sit behind More filters, which counts the set ones.
  const main = defs.slice(0, 3);
  const more = defs.slice(3);
  const chips: FilterChip[] = defs
    .filter(d => valueOf(d))
    .map(d => ({
      id: d.id,
      label: `${d.label}: ${d.choices.find(c => c.id === valueOf(d))?.label ?? valueOf(d)}`,
      onRemove: () => {
        const next = { ...filter };
        delete next[d.key];
        onFilter(next);
      },
    }));
  return (
    <>
      <TabControls>
        {main.map(pick)}
        <MoreFiltersButton
          open={moreOpen}
          onToggle={() => setMoreOpen(o => !o)}
          active={more.filter(d => valueOf(d)).length}
          controls="metrics-filter-more"
          testId="metrics-filter-more-button"
        />
      </TabControls>
      {moreOpen && (
        <div
          id="metrics-filter-more"
          className="flex flex-col gap-3 bg-neutral-50 p-3 sm:flex-row sm:flex-nowrap sm:items-end"
          data-testid="metrics-filter-more"
        >
          {more.map(pick)}
        </div>
      )}
      <FilterChips chips={chips} onClearAll={() => onFilter({})} testId="metrics-filter-chips" />
    </>
  );
};
