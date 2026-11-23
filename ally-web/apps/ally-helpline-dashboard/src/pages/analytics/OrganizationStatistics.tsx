import { FunctionComponent, Suspense, lazy } from "react";

import { SkeletonText } from "@ally-ui-mono/ui-shared";
import { useGetStatisticsChartLibraryQuery } from "@api";

import OrganizationMetrics from "./OrganizationMetrics";

// The new dashboard pulls in the chart library and its renderers. Lazy, so a
// tenant the page is off for never loads any of it.
const StatisticsDashboard = lazy(() =>
  import("./statistics/StatisticsDashboard").then(m => ({ default: m.StatisticsDashboard })),
);

/**
 * The Org tab's native content: the new chart-library dashboard for tenants it
 * is switched on for, otherwise the existing Organization Metrics view.
 *
 * Falls back to the existing view when the library cannot be read (an older
 * backend without the endpoint, or a failed request), so the Statistics page
 * never goes blank because of the new feature.
 */
export const OrganizationStatistics: FunctionComponent = () => {
  const { data: library, isLoading } = useGetStatisticsChartLibraryQuery();

  if (isLoading) {
    return (
      <div className="py-4" data-testid="organization-statistics-loading">
        <SkeletonText heading width="240px" />
      </div>
    );
  }

  if (library?.enabled) {
    return (
      <Suspense fallback={null}>
        <StatisticsDashboard charts={library.charts} />
      </Suspense>
    );
  }

  return <OrganizationMetrics />;
};

// Default export so Analytics.tsx can React.lazy() this section.
export default OrganizationStatistics;
