import { FunctionComponent, Suspense, lazy } from "react";

import { SkeletonText } from "@ally-ui-mono/ui-shared";
import { useGetStatisticsChartLibraryQuery } from "@api";

import OrganizationMetrics from "./OrganizationMetrics";

// The new dashboard pulls in the chart library and its renderers. Lazy, so a
// tenant the page is off for never loads any of it.
const StatisticsPage = lazy(() =>
  import("./statistics/StatisticsPage").then(m => ({ default: m.StatisticsPage })),
);

/**
 * The Org tab's native content: the Statistics page (For you, Organisation, Course,
 * Learner) for tenants it is switched on for, otherwise the existing Organization Metrics view.
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

  // A backend older than the tabs sends no views: keep the existing view then.
  if (library?.enabled && library.views?.length) {
    return (
      <Suspense fallback={null}>
        <StatisticsPage library={library} />
      </Suspense>
    );
  }

  return <OrganizationMetrics />;
};

// Default export so Analytics.tsx can React.lazy() this section.
export default OrganizationStatistics;
