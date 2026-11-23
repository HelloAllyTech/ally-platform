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
export type HeadlineNumbersData = GetOrganizationMetricsResponse["summary"] & {
  /** The period just before the selected one; null for "all time". */
  previous: { activeUsers: number; simulationsCompleted: number } | null;
};

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

/** TSQ-020 */
export interface ScoreDistributionData {
  /** Ten bins: 0-9, 10-19, ... 90-100. */
  bins: number[];
  sessions: number;
  median: number | null;
}

/** TSQ-021 */
export interface LearnerTrendData {
  improving: number;
  holding: number;
  declining: number;
  /** Learners with at least two scored sessions in the period. */
  total: number;
  /** Points a score must move to count as up or down. */
  threshold: number;
}

/** TSQ-022 */
export interface ScenarioScoresData {
  /** Lowest average first. */
  rows: Array<{ scenarioId: number; title: string; averageScore: number; sessions: number }>;
}

/** TSQ-026 */
export interface RatingsData {
  /** Index 0 is one star, index 4 is five stars. */
  stars: number[];
  count: number;
  average: number | null;
}

/** TSQ-027 */
export interface ReviewCoverageData {
  completedSessions: number;
  reviewedSessions: number;
}

/** TSQ-014 */
export interface CoursesInUseData {
  total: number;
  inUse: number;
  idle: number;
  truncated: boolean;
}

/** TSQ-015 and TSQ-016 */
export interface CourseRankingData {
  truncated: boolean;
  rows: Array<{ id: string; title: string; count: number }>;
}

/** TSQ-017 */
export interface CourseFunnelData {
  truncated: boolean;
  stages: Array<{ key: "assigned" | "started" | "halfway" | "completed"; count: number }>;
}
