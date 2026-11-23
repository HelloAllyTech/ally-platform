import { FunctionComponent } from "react";

import { useTranslation } from "react-i18next";

import { SkeletonPlaceholder } from "@ally-ui-mono/ui-shared";
import { useGetStatisticsChartQuery } from "@api";
import type { OrganizationMetricsRange, StatisticsChartEntry } from "@types";

import { CHART_RENDERERS } from "./renderers";
import { StatCard } from "./StatCard";

interface ChartHostProps {
  entry: StatisticsChartEntry;
  range: OrganizationMetricsRange;
}

/**
 * One dashboard card. Fetches its own data (so only charts on the dashboard
 * load), and owns the loading, error and unavailable states so a slow or
 * failed chart never takes the rest of the page with it.
 *
 * A normal chart sits in a {@link StatCard}: the question as the heading, a
 * takeaway sentence, then the chart. A `bare` chart (the headline tiles) draws
 * its own surface; `self` charts (the tables) fetch for themselves.
 */
export const ChartHost: FunctionComponent<ChartHostProps> = ({ entry, range }) => {
  const { t } = useTranslation();
  const renderer = CHART_RENDERERS[entry.id];
  const unavailable = entry.state === "unavailable";

  const { data, isFetching, isError, refetch } = useGetStatisticsChartQuery(
    { id: entry.id, range },
    { skip: unavailable || !renderer || renderer.kind === "self" },
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
  return (
    <div className="h-full" data-testid={`statistics-card-${entry.id}`}>
      <StatCard
        title={entry.question}
        takeaway={takeaway}
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
