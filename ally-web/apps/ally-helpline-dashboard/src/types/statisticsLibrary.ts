import type {
  GetCourseUsageTableResponse,
  GetLearnerUsageTableResponse,
  GetOrganizationMetricsResponse,
  LearnerUsageStatus,
  OrganizationMetricsRange,
} from "./analytics";

/**
 * Tenant Statistics chart library — the shapes `GET /v1/tenant-analytics/
 * chart-library` and `/charts/:chartId` return. The id list lives in ally-be
 * (`tenant-chart-library.constants.ts`, `TSQ-###`); the renderers for the ids
 * live in `pages/analytics/statistics/renderers.tsx`. Keep the two in sync.
 */

export type StatisticsChartState = "available" | "sparse" | "unavailable";

export type StatisticsChartGroup =
  | "activity"
  | "learners"
  | "courses"
  | "outcomes"
  | "learner_voice"
  | "reviews";

export type StatisticsChartSize = "s" | "m" | "wide";

export interface StatisticsChartEntry {
  /** Stable id, for example `TSQ-001`. */
  id: string;
  title: string;
  /** The question the chart answers. */
  question: string;
  group: StatisticsChartGroup;
  shape: string;
  chart: string;
  size: StatisticsChartSize;
  state: StatisticsChartState;
  /** Why the chart is sparse or unavailable; null when available. */
  reason: string | null;
}

export interface StatisticsChartLibrary {
  /** Whether the new page is switched on for this tenant. */
  enabled: boolean;
  charts: StatisticsChartEntry[];
}

export interface StatisticsChartResponse<T = unknown> {
  id: string;
  state: Exclude<StatisticsChartState, "unavailable">;
  data: T;
}

export interface GetStatisticsChartRequest {
  id: string;
  range?: OrganizationMetricsRange;
  /** Table charts only. */
  search?: string;
  limit?: number;
  offset?: number;
}

/** TSQ-001 */
export type HeadlineNumbersData = GetOrganizationMetricsResponse["summary"];

/** TSQ-002 */
export interface UsageOverTimeData {
  bucket: GetOrganizationMetricsResponse["bucket"];
  activeUsers: GetOrganizationMetricsResponse["activeUsersTrend"];
  simulationsCompleted: GetOrganizationMetricsResponse["simulationsCompletedTrend"];
  newLearners: GetOrganizationMetricsResponse["newLearnersOnboardedTrend"];
}

/** TSQ-003 */
export type MostUsedSimulationsData = GetOrganizationMetricsResponse["mostUsedSimulations"];

/** TSQ-007 */
export interface LearnerStatusCountsData {
  total: number;
  /** True when the organisation has more learners than were counted. */
  truncated: boolean;
  counts: Record<LearnerUsageStatus, number>;
}

/** TSQ-008 */
export interface TopLearnersData {
  rows: Array<{ id: number; name: string; practiceMinutes: number }>;
}

/** TSQ-023 */
export interface AttentionLearnersData {
  /** All learners who qualify; `rows` shows the longest quiet. */
  total: number;
  rows: Array<{
    id: number;
    name: string;
    status: LearnerUsageStatus;
    daysSinceLastActivity: number | null;
  }>;
}

/** TSQ-009 */
export type LearnerTableData = GetLearnerUsageTableResponse;

/** TSQ-013 */
export type CourseTableData = GetCourseUsageTableResponse;
