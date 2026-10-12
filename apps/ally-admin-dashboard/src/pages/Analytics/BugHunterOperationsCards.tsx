import { ReactNode, useMemo, useState } from "react";

import { StackedBarChart } from "@carbon/charts-react";

import { useGetBugHunterOperationsMetricsQuery } from "@api";

import { AnalyticsTabFilters } from "./analyticsFilters";
import {
  OUTCOME_SCALE,
  OpsBar,
  OpsDatum,
  buildFiledSeries,
  buildFiledTable,
  filedEmptyText,
  filedTakeaway,
  operationsWindowLabel,
  rangeToDays,
} from "./bugHunterOperationsChart";
import { ChartDetailModal, ChartTableData } from "./ChartDetailModal";
import { CHART_HEIGHT, ChartCard, ScrollableChart, buildSource, stackedBarOpts } from "./chartKit";

/**
 * Bug Hunter's volume, beside its rates.
 *
 * The trend cards above this answer whether the agent is right, fast, cheap
 * and reliable — all rates, all week-bucketed. This one answers the
 * operator's Monday-morning question, which is a count and day-shaped: did
 * last night file anything, and does what it files hold up.
 *
 * Seven cards until 2026-10-12 (by source, difficulty, who reports, tokens by
 * trigger, spend over time, code breadth, tokens by model). Nobody acted on
 * them, and cost already has its own chart above and the AI cost tab, so they
 * went; `bugHunterOperationsChart.ts` and the endpoint still carry their
 * series for a card that earns its way back.
 *
 * Reads `GET /v1/bug-hunter/metrics/operations`, which is anchored on today
 * and takes a day count, so the page range is mapped to days
 * (`rangeToDays`) and the card says what window it actually covered.
 *
 * Every count is drawn beside where that cohort stands now — accepted,
 * declined, undecided — because a bar of "12 filed" on its own rewards the
 * noisiest finder exactly as much as the best one.
 */
export const BugHunterOperationsCards = ({ query }: AnalyticsTabFilters) => {
  const days = rangeToDays(query);
  const { data, isLoading, isError, refetch } = useGetBugHunterOperationsMetricsQuery({ days });

  const dayRows = useMemo(() => data?.days ?? [], [data]);
  const window = operationsWindowLabel(data);
  const source = (derivation: string) => buildSource({ derivation, window });
  const common = { loading: isLoading && !data, error: isError, onRetry: refetch };

  const filedSeries = useMemo(() => buildFiledSeries(dayRows), [dayRows]);
  const countOpts = useMemo(
    () =>
      stackedBarOpts({ leftTitle: "Bugs", bottomTitle: "Day (UTC)", colorScale: OUTCOME_SCALE }),
    [],
  );
  return (
    <div className="flex flex-col gap-6">
      <OpsCard
        wide
        title="Bugs filed per day"
        caption="Distinct bugs Bug Hunter filed each day, from every source, coloured by where each stands today. A re-discovery touches its existing row rather than filing a new one, so nothing counts twice. Days are UTC, the clock the sweeps run on."
        source={source(
          "bug_findings, one row per bug, by createdAt day; status folded to accepted / declined / undecided",
        )}
        takeaway={filedTakeaway(data ?? emptyMetrics)}
        emptyText={filedEmptyText(data)}
        table={buildFiledTable(dayRows)}
        chartId="AAQ-158"
        {...common}
        render={height => (
          <ScrollableChart data={filedSeries}>
            <StackedBarChart data={filedSeries} options={{ ...countOpts, height }} />
          </ScrollableChart>
        )}
      />
    </div>
  );
};

/** A zero-valued response, so takeaway builders can run before data arrives without a null branch each. */
const emptyMetrics = {
  windowDays: 0,
  since: "",
  days: [],
  bySource: [],
  byDifficulty: [],
  breadth: null,
  byReporter: [],
  tokensByModel: [],
  totals: {
    filed: 0,
    accepted: 0,
    declined: 0,
    undecided: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    runs: 0,
  },
};

interface OpsCardProps {
  title: string;
  caption: string;
  source: string;
  takeaway?: string;
  emptyText?: string;
  table: ChartTableData;
  tableCaption?: string;
  chartId: string;
  /** A control that belongs to this card alone (a period picker, say), rendered in its header. */
  controls?: ReactNode;
  wide?: boolean;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  render: (height: string) => ReactNode;
}

/**
 * One card plus its dense-tier modal, so each of the seven charts carries a
 * table view and an export without repeating the wiring seven times. The
 * table is the accessibility twin of the chart: every number the bars
 * encode is reachable without hovering or reading colour.
 */
const OpsCard = ({
  title,
  caption,
  source,
  takeaway,
  emptyText,
  table,
  tableCaption,
  chartId,
  controls,
  wide,
  loading,
  error,
  onRetry,
  render,
}: OpsCardProps) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <ChartCard
        wide={wide}
        title={title}
        caption={caption}
        source={source}
        takeaway={takeaway}
        loading={loading}
        error={error}
        onRetry={onRetry}
        errorTitle={`Couldn't load “${title}”`}
        empty={!loading && Boolean(emptyText)}
        emptyText={emptyText}
        onExpand={() => setExpanded(true)}
        height={CHART_HEIGHT}
        chartId={chartId}
        controls={controls}
      >
        {render(CHART_HEIGHT)}
      </ChartCard>
      {expanded && (
        <ChartDetailModal
          open={expanded}
          onClose={() => setExpanded(false)}
          title={title}
          caption={tableCaption ?? caption}
          source={source}
          table={table}
          exportContext={[source]}
          render={({ height }) => render(height)}
        />
      )}
    </>
  );
};

export type { OpsBar, OpsDatum };
