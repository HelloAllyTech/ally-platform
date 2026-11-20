import "@carbon/charts/styles.css";
import "../Analytics/analytics-carbon.scss";
import React, { useState } from "react";

import { useGetDebriefMetricsQuery } from "@api";
import { en } from "@constants";
import {
  AnalyticsRange,
  DebriefMetricsFilter,
  DebriefMetricsView,
  DebriefPassRateSegment,
} from "@types";

import { ChartCard, KpiTile } from "../Analytics/chartKit";
import { AgentsMetricsSection } from "./metrics/AgentsMetricsSection";
import { hasLiveDebriefs } from "./metrics/metricsData";
import { EfficiencyCard } from "./metrics/MetricsEfficiencyCard";
import { ExperienceSection } from "./metrics/MetricsExperienceSection";
import { FilterBar } from "./metrics/MetricsFilterBar";
import { GuardrailsCard } from "./metrics/MetricsGuardrailsCard";
import { HeadlineTiles } from "./metrics/MetricsHeadlineTiles";
import { QualitySection } from "./metrics/MetricsQualitySection";
import { TILE_GRID } from "./metrics/metricsShared";
import { UptakeCard } from "./metrics/MetricsUptakeCard";

/**
 * The page's time range, in the weeks the metrics endpoint reads. Rounded up so the window always
 * covers the range the picker names.
 */
const WEEKS_FOR_RANGE: Record<AnalyticsRange, number> = { "30d": 5, "90d": 13, "12m": 52, all: 52 };

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

const MetricsSkeleton: React.FC = () => {
  const t = en.debriefs.metrics.tiles;
  return (
    <div className="flex flex-col gap-6" data-testid="debrief-metrics-loading">
      <div className={TILE_GRID}>
        {[t.hardFail, t.debriefs, t.outages, t.unjudged].map(l => (
          <KpiTile key={l} label={l} value="" loading />
        ))}
      </div>
      <ChartCard title={en.debriefs.metrics.sections.hardFailByWeek} loading />
    </div>
  );
};

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
          <GuardrailsCard view={view} />
          <ExperienceSection view={view} />
          <EfficiencyCard view={view} />
        </>
      )}
      <AgentsMetricsSection agents={view.agents} />
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Headline tiles                                                             */
/* -------------------------------------------------------------------------- */
