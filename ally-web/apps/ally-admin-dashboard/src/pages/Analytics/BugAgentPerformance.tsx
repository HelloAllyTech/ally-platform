import { useMemo } from "react";

import { LineChart, SimpleBarChart } from "@carbon/charts-react";

import { useGetBugAgentPerformanceQuery } from "@api";

import { AnalyticsTabFilters, asOf, windowLabel } from "./analyticsFilters";
import {
  buildCostTrend,
  buildGoalTrend,
  buildMissReasons,
  buildReliabilityTrend,
  buildSourceAccuracyBreakdown,
  buildSpeedTrend,
  buildThroughputTrend,
  COST_SCALE,
  GOAL_SCALE,
  goalTakeaway,
  RELIABILITY_SCALE,
  SPEED_SCALE,
  THROUGHPUT_SCALE,
} from "./bugAgentPerformanceChart";
import { BugHunterDecisionsPanel } from "./BugHunterDecisionsPanel";
import { BugHunterOperationsCards } from "./BugHunterOperationsCards";
import {
  CHART_HEIGHT,
  ChartCard,
  ScrollableChart,
  barOpts,
  buildSource,
  lineOpts,
} from "./chartKit";
import { buildColorScale, formatPercent, formatUsd } from "./tokenChart";
import { RunHistoryTable } from "../BugHunter/RunHistoryTable";
import { TodayBoard } from "../BugHunter/TodayBoard";

/**
 * Bug Hunter's performance, in the charts somebody actually watches: whether
 * it finds bugs before people do and why not, which finder is right how often,
 * does it finish what it starts (throughput), how fast (speed), at what cost,
 * and does it stay healthy while doing it (reliability).
 *
 * Pruned on 2026-10-12 to what is observed: the overall precision trend
 * (Precision by finder is the one that says what to fix), "Bugs found per
 * day" (the operations card "Bugs filed per day" shows the same count beside
 * where each bug stands), and six operations cards nobody acted on went. The
 * chart helpers and the endpoints still serve those series, so a card can come
 * back without backend work.
 *
 * Deliberately week-bucketed regardless of the tab-wide range picker's
 * `range` — the backend (`BugAgentPerformanceAnalyticsService`) always
 * truncs to calendar week, since day-by-day would be too noisy for rates
 * this thin and month-by-month too coarse to catch a drift early. The range
 * picker still controls how FAR BACK the trend goes.
 *
 * Reuses the exact funnel arithmetic `AccuracyPanel.tsx`'s single-window
 * figures already use, applied per week server-side — this tab does not
 * recompute anything the accuracy panel didn't already define correctly.
 *
 * Since OPP-0749 (2026-10-05) this tab also closes with the shift log, the
 * per-run ledger everything above aggregates — the one panel kept from the
 * Bug Hunter page's retired Performance tab. The scorecard and the accuracy
 * panel moved here with it and were removed the same day at the product
 * head's request: the trends and operations charts already carry their figures. The Bug
 * Hunter page keeps Work and Notebook; its old `?section=performance` redirects
 * here. "Today, by repo" joined the shift log here on 2026-10-13. The shift log's "N found" links jump back to that page's
 * table — see `RunHistoryTable`.
 */
export const BugAgentPerformance = (filters: AnalyticsTabFilters) => {
  const { query } = filters;
  const { data, isLoading, isError, refetch } = useGetBugAgentPerformanceQuery(query);

  const bySource = useMemo(() => data?.precision.bySource ?? [], [data]);
  const throughputWeekly = useMemo(() => data?.throughput ?? [], [data]);
  const speedWeekly = useMemo(() => data?.speed ?? [], [data]);
  const costWeekly = useMemo(() => data?.cost ?? [], [data]);
  const reliabilityWeekly = useMemo(() => data?.reliability ?? [], [data]);
  const goalWeekly = useMemo(() => data?.goal?.weekly ?? [], [data]);
  const goalTrend = useMemo(() => buildGoalTrend(goalWeekly), [goalWeekly]);
  const missReasons = useMemo(() => buildMissReasons(data?.goal?.window.missReasons ?? {}), [data]);

  const sourceAccuracy = useMemo(() => buildSourceAccuracyBreakdown(bySource), [bySource]);
  const throughputTrend = useMemo(() => buildThroughputTrend(throughputWeekly), [throughputWeekly]);
  const speedTrend = useMemo(() => buildSpeedTrend(speedWeekly), [speedWeekly]);
  const costTrend = useMemo(() => buildCostTrend(costWeekly), [costWeekly]);
  const reliabilityTrend = useMemo(
    () => buildReliabilityTrend(reliabilityWeekly),
    [reliabilityWeekly],
  );

  // `extra` on the chartKit factories replaces a whole top-level key rather
  // than deep-merging it, so a percentage tick formatter has to be added by
  // hand onto the built options' own `axes.left`, same pattern
  // `CodingAgentCost.tsx`'s `withUsdTicks` already established for currency.
  const withPercentTicks = <T extends { axes: { left: Record<string, unknown> } }>(
    options: T,
  ): T => ({
    ...options,
    axes: {
      ...options.axes,
      left: {
        ...options.axes.left,
        ticks: { formatter: (tick: number | Date) => formatPercent(Number(tick)) },
      },
    },
  });

  const sourceAccuracyOptions = useMemo(
    () =>
      withPercentTicks(
        barOpts({
          leftTitle: "Accuracy",
          colorScale: buildColorScale(sourceAccuracy.map(d => d.group)),
        }),
      ),
    [sourceAccuracy],
  );
  const throughputOptions = useMemo(
    () => withPercentTicks(lineOpts({ leftTitle: "Rate", colorScale: THROUGHPUT_SCALE })),
    [],
  );
  const speedOptions = useMemo(
    () => lineOpts({ leftTitle: "Median hours", colorScale: SPEED_SCALE }),
    [],
  );
  const costOptions = useMemo(() => lineOpts({ leftTitle: "USD", colorScale: COST_SCALE }), []);
  const goalOptions = useMemo(
    () => withPercentTicks(lineOpts({ leftTitle: "Share", colorScale: GOAL_SCALE })),
    [],
  );
  const missOptions = useMemo(
    () =>
      barOpts({
        leftTitle: "Human reports",
        colorScale: buildColorScale(missReasons.map(d => d.group)),
      }),
    [missReasons],
  );
  const reliabilityOptions = useMemo(
    () => withPercentTicks(lineOpts({ leftTitle: "Rate", colorScale: RELIABILITY_SCALE })),
    [],
  );

  const window = windowLabel(data?.window);
  const source = (derivation: string) =>
    buildSource({ derivation, window, asOf: asOf(data?.window) });

  const latestCost = costWeekly.at(-1);
  const latestReliability = reliabilityWeekly.at(-1);

  return (
    <div className="flex flex-col gap-6">
      {/* The goal, first (OPP-0778): Bug Hunter exists to find a bug before any
          staff member or live user does. Everything below is how; this is
          whether. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Are we finding bugs before people do?"
          caption="Per week: the share of real bugs Bug Hunter's own senses filed rather than a person, and the share of human reports whose repo a sweep had completed in the previous seven days — a bug it had read past. Declines as not a bug, duplicate or wrong repo are left out of both."
          source={source(
            "bug_findings by createdAt week and source, less finder-error declines; escapes join human reports to completed sweeps on the same repo within 7 days; time to fix joins merged events to the finding's filing",
          )}
          takeaway={goalTakeaway(data?.goal?.window)}
          loading={isLoading && !data}
          error={isError}
          onRetry={refetch}
          errorTitle="Couldn't load the goal numbers"
          empty={goalTrend.length === 0}
          emptyText="Nothing found by anyone yet in this window"
          height={CHART_HEIGHT}
          chartId="AAQ-233"
        >
          <ScrollableChart data={goalTrend}>
            <LineChart data={goalTrend} options={goalOptions} />
          </ScrollableChart>
        </ChartCard>

        <ChartCard
          title="Why people found bugs first"
          caption="Every human report in the window, by why Bug Hunter did not find it first, as its miss classifier judged it. The biggest bar is the next sense to build or fix."
          source={source(
            "bug_findings.metadata.miss.reason on reported_bug rows in the window; rows the classifier has not reached yet count as not classified",
          )}
          loading={isLoading && !data}
          error={isError}
          onRetry={refetch}
          errorTitle="Couldn't load the miss reasons"
          empty={missReasons.length === 0}
          emptyText="No human reports in this window"
          height={CHART_HEIGHT}
          chartId="AAQ-234"
        >
          <ScrollableChart data={missReasons} on="group">
            <SimpleBarChart data={missReasons} options={missOptions} />
          </ScrollableChart>
        </ChartCard>
      </div>

      <ChartCard
        title="Precision by finder"
        caption="Whole-window accuracy per finder type — worst first. The finder with the lowest bar is the one to fix or retire. code_review has no external ground truth, so it's structurally the one most likely to trail."
        source={source("bug_findings, whole window (not bucketed)")}
        loading={isLoading && !data}
        error={isError}
        onRetry={refetch}
        errorTitle="Couldn't load the finder breakdown"
        empty={sourceAccuracy.length === 0}
        emptyText="No finder has a judged finding yet in this window"
        wide
        height={CHART_HEIGHT}
        chartId="AAQ-131"
      >
        <ScrollableChart data={sourceAccuracy} on="group">
          <SimpleBarChart data={sourceAccuracy} options={sourceAccuracyOptions} />
        </ScrollableChart>
      </ChartCard>

      <ChartCard
        title="Fix throughput"
        caption="Does an approved fix actually land? Approved→merged rate, escalation rate, and Gemini-to-Claude fallback rate, per week."
        source={source("bug_findings + bug_hunt_runs + bug_hunt_events, per week")}
        loading={isLoading && !data}
        error={isError}
        onRetry={refetch}
        errorTitle="Couldn't load fix throughput"
        empty={throughputTrend.length === 0}
        emptyText="No fix-session activity recorded yet in this window"
        wide
        height={CHART_HEIGHT}
        chartId="AAQ-132"
      >
        <ScrollableChart data={throughputTrend}>
          <LineChart data={throughputTrend} options={throughputOptions} />
        </ScrollableChart>
      </ChartCard>

      <ChartCard
        title="Speed"
        caption="Median hours from filed to decided/merged, merged to released, and dispatch to first activity (isolates runner queue delay from actual fix time)."
        source={source("bug_findings + bug_hunt_events, per week")}
        loading={isLoading && !data}
        error={isError}
        onRetry={refetch}
        errorTitle="Couldn't load speed"
        empty={speedTrend.length === 0}
        emptyText="No stage transitions recorded yet in this window"
        wide
        height={CHART_HEIGHT}
        chartId="AAQ-133"
      >
        <ScrollableChart data={speedTrend}>
          <LineChart data={speedTrend} options={speedOptions} />
        </ScrollableChart>
      </ChartCard>

      <ChartCard
        title="Cost"
        caption="All Bug Hunter spend (sweeps + fix sessions), per week."
        takeaway={
          latestCost
            ? `Most recent week: ${formatUsd(latestCost.totalUsd)} total${
                latestCost.costPerMergedFixUsd != null
                  ? `, ${formatUsd(latestCost.costPerMergedFixUsd)} per merged fix`
                  : ""
              }`
            : undefined
        }
        source={source("bug_hunt_runs, per week")}
        loading={isLoading && !data}
        error={isError}
        onRetry={refetch}
        errorTitle="Couldn't load cost"
        empty={costTrend.length === 0}
        emptyText="No Bug Hunter spend recorded yet in this window"
        wide
        height={CHART_HEIGHT}
        chartId="AAQ-134"
      >
        <ScrollableChart data={costTrend}>
          <LineChart data={costTrend} options={costOptions} />
        </ScrollableChart>
      </ChartCard>

      <ChartCard
        title="Reliability"
        caption="Run completion rate, fallback rate, and regression rate — does Bug Hunter finish cleanly and do its fixes hold?"
        takeaway={
          latestReliability?.completionRate != null
            ? `Most recent week: ${formatPercent(latestReliability.completionRate)} of runs completed`
            : undefined
        }
        source={source("bug_hunt_runs + bug_hunt_events + bug_findings, per week")}
        loading={isLoading && !data}
        error={isError}
        onRetry={refetch}
        errorTitle="Couldn't load reliability"
        empty={reliabilityTrend.length === 0}
        emptyText="No runs recorded yet in this window"
        wide
        height={CHART_HEIGHT}
        chartId="AAQ-135"
      >
        <ScrollableChart data={reliabilityTrend}>
          <LineChart data={reliabilityTrend} options={reliabilityOptions} />
        </ScrollableChart>
      </ChartCard>

      {/* The rates above say whether Bug Hunter is any good; the count below
          says what it actually turned up, day by day, beside where each bug
          stands now. A separate card rather than a line on the trends: a
          volume and a rate share no axis. */}
      <div className="pt-2">
        <h3 className="text-sm font-semibold text-typography-900">What it turns up, day by day</h3>
        <p className="text-xs text-typography-600">
          How many bugs get filed each day and how many of them hold up. Day-bucketed and UTC, from
          the same page range mapped to a day count.
        </p>
      </div>
      <BugHunterOperationsCards {...filters} />

      {/* The cells the orchestrator reads before it decides, and the replay
          that says whether its owners should change (OPP-0776 / OPP-0783). */}
      <BugHunterDecisionsPanel {...filters} />

      {/* Today so far, one row per repo — the day the shift log's newest rows
          belong to, summed. Moved here from Bug Hunter's Work tab on
          2026-10-13: a report on the day, for the reader who reads the runs. */}
      <div className="pt-2">
        <TodayBoard />
      </div>

      {/* The per-run ledger every number above aggregates: status, trigger,
          cost and the GitHub run for each sweep and fix session. The only view
          of that, so it stays reachable here after leaving the agent's page. */}
      <div data-chart-id="AAQ-200" className="pt-2">
        <RunHistoryTable />
      </div>
    </div>
  );
};
