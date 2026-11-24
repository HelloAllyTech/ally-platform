import { FunctionComponent, useMemo } from "react";

import { useTranslation } from "react-i18next";

import { SkeletonPlaceholder } from "@ally-ui-mono/ui-shared";
import { useGetStatisticsChartQuery } from "@api";
import type {
  OrganizationMetricsRange,
  StatisticsChartEntry,
  StatisticsFilterKey,
  StatisticsFilterValues,
} from "@types";

import { CardFilters } from "./CardFilters";
import { CHART_RENDERERS } from "./renderers";
import { StatCard } from "./StatCard";

interface ChartHostProps {
  entry: StatisticsChartEntry;
  range: OrganizationMetricsRange;
  /** The filters set on this card: the course, simulation or learner chosen. */
  filters?: StatisticsFilterValues;
  /** Called when a filter is changed. Without it the card shows its filters but cannot change them. */
  onFiltersChange?: (filters: StatisticsFilterValues) => void;
  /** Filters the view supplies (its chosen course or learner): in `filters`, but not offered on the card. */
  lockedFilters?: readonly StatisticsFilterKey[];
  /** Pins the card to For you. Absent when the page is being customised. */
  onTogglePin?: () => void;
  pinned?: boolean;
}

/** The request fields for a card's filters. A simulation or learner id is a number. */
export const filterParams = (filters: StatisticsFilterValues) => {
  const params: { courseId?: string; scenarioId?: number; learnerId?: number } = {};
  if (filters.course) params.courseId = filters.course;
  const scenarioId = Number(filters.simulation);
  if (filters.simulation && Number.isInteger(scenarioId)) params.scenarioId = scenarioId;
  const learnerId = Number(filters.learner);
  if (filters.learner && Number.isInteger(learnerId)) params.learnerId = learnerId;
  return params;
};

/**
 * One dashboard card. Fetches its own data (so only charts on the dashboard
 * load), and owns the loading, error and unavailable states so a slow or
 * failed chart never takes the rest of the page with it.
 *
 * A normal chart sits in a {@link StatCard}: the question as the heading, a
 * takeaway sentence, then the chart. A `bare` chart (the headline tiles) draws
 * its own surface; `self` charts (the tables) fetch for themselves.
 */
export const ChartHost: FunctionComponent<ChartHostProps> = ({
  entry,
  range,
  filters = {},
  onFiltersChange,
  lockedFilters,
  onTogglePin,
  pinned = false,
}) => {
  const { t } = useTranslation();
  const renderer = CHART_RENDERERS[entry.id];
  const unavailable = entry.state === "unavailable";

  // The viewer's own time zone, so charts that group by time of day match their clock.
  const timezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
    } catch {
      return undefined;
    }
  }, []);

  // A card with a required filter (it has no all-organisation view) waits for a choice.
  const missing = entry.filters.find(f => f.required && !filters[f.key]);

  // `currentData`, not `data`: after a filter changes the card shows loading, never
  // the previous filter's numbers under the new filter's name.
  const {
    currentData: data,
    isFetching,
    isError,
    refetch,
  } = useGetStatisticsChartQuery(
    { id: entry.id, range, timezone, ...filterParams(filters) },
    { skip: unavailable || !renderer || renderer.kind === "self" || !!missing },
  );

  // An id the backend offers but this build has no renderer for: show nothing
  // rather than a broken card. The library lists only charts with a renderer.
  if (!renderer) return null;

  if (unavailable) {
    return (
      <section
        className="rounded-xl border border-dashed border-[#cfc9bb] bg-[#f1eee6] p-5 md:px-6"
        data-testid={`statistics-card-${entry.id}-unavailable`}
      >
        <h2 className="text-base font-semibold text-typography-900">{entry.question}</h2>
        <p className="mt-2 text-sm text-typography-600">
          {t("statisticsLibrary.card.unavailable")}
          {entry.reason ? ` ${entry.reason}` : ""}
        </p>
      </section>
    );
  }

  if (renderer.kind === "self") {
    const SelfComponent = renderer.Component;
    return <SelfComponent entry={entry} range={range} />;
  }

  const DataComponent = renderer.Component;
  const loading = isFetching && !data;

  if (renderer.bare && !isError) {
    return (
      <div data-testid={`statistics-card-${entry.id}`}>
        {loading || !data ? (
          <div
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
            role="status"
            aria-label={t("statisticsLibrary.card.loading")}
          >
            {[0, 1, 2, 3].map(i => (
              <SkeletonPlaceholder key={i} className="analytics-chart-skeleton" />
            ))}
          </div>
        ) : (
          <DataComponent entry={entry} data={data.data} sparse={data.state === "sparse"} />
        )}
      </div>
    );
  }

  const takeaway = data && renderer.takeaway ? renderer.takeaway(data.data, t) : null;
  const labels: Partial<Record<StatisticsFilterKey, string>> = {};
  data?.filters?.forEach(f => {
    labels[f.kind] = f.label;
  });
  const controls =
    entry.filters.length > 0 ? (
      <CardFilters
        filters={entry.filters}
        values={filters}
        hidden={lockedFilters}
        labels={labels}
        onChange={next => onFiltersChange?.(next)}
      />
    ) : null;
  if (missing) {
    return (
      <div className="h-full" data-testid={`statistics-card-${entry.id}`}>
        <StatCard title={entry.question} controls={controls}>
          <p className="text-sm text-typography-600" data-testid="statistics-choose-prompt">
            {t(`statisticsLibrary.filters.pick.${missing.key}`)}
          </p>
        </StatCard>
      </div>
    );
  }

  return (
    <div className="h-full" data-testid={`statistics-card-${entry.id}`}>
      <StatCard
        title={entry.question}
        takeaway={takeaway}
        controls={controls}
        pin={
          onTogglePin && renderer.pin
            ? {
                pinned,
                label: t(
                  pinned ? "statisticsLibrary.pins.unpinAria" : "statisticsLibrary.pins.pinAria",
                  { title: entry.question },
                ),
                onToggle: onTogglePin,
              }
            : undefined
        }
        loading={loading}
        error={isError}
        onRetry={refetch}
      >
        {data && (
          <>
            {data.state === "sparse" && (
              <p className="mb-2 text-xs text-typography-500">
                {t("statisticsLibrary.card.sparseNote")}
              </p>
            )}
            <DataComponent entry={entry} data={data.data} sparse={data.state === "sparse"} />
          </>
        )}
      </StatCard>
    </div>
  );
};
