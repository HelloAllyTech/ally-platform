import React, { useMemo, useState } from "react";

import "@carbon/charts/styles.css";
import "../Analytics/analytics-carbon.scss";

import { Button, CarbonDropdown as Dropdown } from "@ally-ui-mono/ui-shared";
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
  DebriefRate,
} from "@types";

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
  const q = useGetDebriefMetricsQuery({ weeks, ...filter });

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
      <MetricsBody view={q.data} filter={filter} onFilter={setFilter} />
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
}> = ({ view, filter, onFilter }) => {
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
          <QualitySection quality={view.quality} />
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

const groupRows = (list: DebriefPassBreakdownRow[]): RateRow[] => {
  return list.map(r => ({
    key: r.key,
    label: r.key,
    rate: r.passRate,
    extra: en.debriefs.metrics.sections.groupExtra(pct(r.hardFailRate), fixed(r.judgeMean, 1)),
  }));
};

const groupTable = (list: DebriefPassBreakdownRow[]): string[][] =>
  list.map(r => [
    r.key,
    String(r.debriefs),
    rateWithRange(r.passRate),
    rateWithRange(r.hardFailRate),
    fixed(r.judgeMean, 2),
  ]);

/**
 * The pass rate (same definition as the test-set evals): by week as a line with
 * its 95% band, then every breakdown as dot-and-whisker rows.
 */
const QualitySection: React.FC<{ quality: DebriefMetricsView["quality"] }> = ({ quality }) => {
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
  const segmentRows: RateRow[] = quality.bySegment.map(g => ({
    key: `${g.language}|${g.writerModel}|${g.judgeVersion}`,
    label: g.language,
    sublabel: `${g.writerModel} · ${g.judgeVersion}`,
    rate: g.passRate,
  }));
  const b = quality.breakdowns;
  const k = s.breakdowns;
  const breakdowns: Array<{
    id: string;
    title: string;
    help?: string;
    list: DebriefPassBreakdownRow[];
    sort?: boolean;
    top?: number;
  }> = b
    ? [
        { id: "skill", title: k.skill, help: k.skillHelp, list: b.skill, top: 8 },
        { id: "scenario", title: k.scenario, list: b.scenario, top: 8 },
        { id: "course", title: k.course, help: k.courseHelp, list: b.course },
        { id: "session-length", title: k.sessionLength, list: b.sessionLength, sort: false },
        { id: "step-model", title: k.stepModel, help: k.stepModelHelp, list: b.stepModel },
        { id: "risk", title: k.risk, list: b.risk, sort: false },
      ]
    : [];
  const head = [k.key, c.debriefs, c.passRate, c.hardFailRate, c.judgeMean];

  return (
    <section className="flex flex-col gap-4" data-testid="metrics-quality">
      <SectionHeading title={s.heading} help={s.help} />
      {weeks.length === 0 ? (
        <p className="text-sm text-typography-700">{s.empty}</p>
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
                  rows={groupRows(languageRows)}
                  max={1}
                  testId="metrics-by-language-dots"
                />
                <NumbersTable
                  testId="metrics-quality-languages"
                  head={[c.language, c.debriefs, c.passRate, c.hardFailRate, c.judgeMean]}
                  rows={groupTable(languageRows)}
                />
              </ChartCard>
            )}
            {segmentRows.length > 0 && (
              <ChartCard
                title={s.bySegment}
                titleHelp={<InfoTip label={s.segmentHelp} ariaLabel={`About ${s.bySegment}`} />}
                caption={sec.breakdownsCaption}
              >
                <RateDots rows={segmentRows} max={1} testId="metrics-by-segment-dots" />
                <NumbersTable
                  testId="metrics-quality-segments"
                  head={[c.language, c.writerModel, c.judgeVersion, c.debriefs, c.passRate]}
                  rows={quality.bySegment.map(g => [
                    g.language,
                    g.writerModel,
                    g.judgeVersion,
                    String(g.debriefs),
                    rateWithRange(g.passRate),
                  ])}
                />
              </ChartCard>
            )}
          </div>

          {breakdowns.some(t => t.list.length > 0) && (
            <div className="flex flex-col gap-3" data-testid="metrics-quality-breakdowns">
              <h4 className="text-base font-semibold text-typography-900">{k.heading}</h4>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {breakdowns
                  .filter(t => t.list.length > 0)
                  .map(t => (
                    <ChartCard
                      key={t.id}
                      title={t.title}
                      titleHelp={
                        t.help ? (
                          <InfoTip label={t.help} ariaLabel={`About ${t.title}`} />
                        ) : undefined
                      }
                      caption={t.sort === false ? undefined : sec.breakdownsCaption}
                    >
                      <div data-testid={`metrics-breakdown-${t.id}`}>
                        <RateDots
                          rows={groupRows(t.list)}
                          sort={t.sort}
                          top={t.top}
                          max={1}
                          testId={`metrics-breakdown-${t.id}-dots`}
                        />
                        <NumbersTable head={head} rows={groupTable(t.list)} />
                      </div>
                    </ChartCard>
                  ))}
              </div>
            </div>
          )}
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
    {
      key: "safety",
      label: s.guardrails.safety,
      targetLabel: "100% × 3",
      value: null,
      max: 1,
      words: s.guardrails.safetyNote,
      state: "no_data",
    },
  ];
  return (
    <ChartCard title={s.guardrails.heading} caption={s.sections.guardrailsCaption}>
      <BulletRows rows={rows} testId="metrics-guardrails" />
    </ChartCard>
  );
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
}> = ({ title, testId, rows }) => {
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
              {r.key} <span className="text-typography-500">({r.debriefs})</span>
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
                    title={`${r.key}: ${pctNum(rate.value)} (${s.count(rate.n, rate.of)})${thin ? ` · ${s.states.thin}` : ""}`}
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
            r.key,
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
  if (!options) return null;
  const set = (patch: Partial<DebriefMetricsFilter>) => onFilter({ ...filter, ...patch });
  type Item = { id: string; label: string };
  const pick = (
    id: string,
    label: string,
    value: string | number | undefined,
    choices: Item[],
    onChange: (v: string) => void,
    width = "sm:w-44",
  ) => {
    const items: Item[] = [{ id: "", label: s.allOf[id] ?? s.all }, ...choices];
    return (
      <div className={`w-full ${width}`} key={id} data-testid={`metrics-filter-${id}`}>
        <Dropdown
          id={`debrief-metrics-${id}`}
          size="md"
          titleText={label}
          hideLabel
          label={label}
          items={items}
          selectedItem={
            items.find(i => i.id === (value === undefined ? "" : String(value))) ?? items[0]
          }
          itemToString={(item: Item | null) => item?.label ?? ""}
          onChange={({ selectedItem }: { selectedItem: Item | null }) =>
            onChange(selectedItem?.id ?? "")
          }
        />
      </div>
    );
  };
  const active = Object.values(filter).some(v => v !== undefined && v !== "");
  return (
    <TabControls>
      {pick(
        "organisation",
        s.organisation,
        filter.tenantId,
        options.organisations.map(o => ({ id: o.id, label: o.name })),
        v => set({ tenantId: v || undefined }),
        "sm:w-56",
      )}
      {pick(
        "language",
        s.language,
        filter.language,
        options.languages.map(l => ({ id: l, label: l })),
        v => set({ language: v || undefined }),
      )}
      {pick(
        "learnerLevel",
        s.learnerLevel,
        filter.learnerLevel,
        options.learnerLevels.map(l => ({ id: l, label: s.levels[l] ?? l })),
        v => set({ learnerLevel: v || undefined }),
        "sm:w-56",
      )}
      {pick(
        "recipe",
        s.recipe,
        filter.recipe,
        options.recipes.map(r => ({ id: r, label: s.recipes[r] ?? r })),
        v => set({ recipe: v || undefined }),
      )}
      {pick(
        "releaseVersion",
        s.releaseVersion,
        filter.releaseVersion,
        options.releaseVersions.map(v => ({ id: String(v), label: s.release(v) })),
        v => set({ releaseVersion: v ? Number(v) : undefined }),
        "sm:w-40",
      )}
      {pick(
        "judgeVersion",
        s.judgeVersion,
        filter.judgeVersion,
        options.judgeVersions.map(v => ({ id: v, label: v })),
        v => set({ judgeVersion: v || undefined }),
        "sm:w-56",
      )}
      {active && (
        <div className="flex items-center">
          <Button
            kind="ghost"
            size="md"
            data-testid="metrics-filter-clear"
            onClick={() => onFilter({})}
          >
            {s.clear}
          </Button>
        </div>
      )}
    </TabControls>
  );
};
