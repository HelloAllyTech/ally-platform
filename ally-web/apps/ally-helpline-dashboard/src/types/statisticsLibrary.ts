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

/** What a chart can be drawn for. The whole organisation is the default. */
export type StatisticsChartScope = "organisation" | "course" | "simulation" | "learner";

/** A scope a chart is drawn for: one course, simulation or learner. */
export type StatisticsScopeKind = Exclude<StatisticsChartScope, "organisation">;

export interface StatisticsScopeOption {
  /** A course uuid, or a simulation or learner id as text. */
  id: string;
  label: string;
}

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
  /** What the chart can be drawn for; always lists the whole organisation. */
  scopes: StatisticsChartScope[];
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
  /** What the chart was drawn for, when it was not the whole organisation. */
  scope?: { kind: StatisticsScopeKind; id: string; label: string };
  state: Exclude<StatisticsChartState, "unavailable">;
  data: T;
}

export interface GetStatisticsChartRequest {
  id: string;
  range?: OrganizationMetricsRange;
  /** IANA time zone, for charts that group by time of day. */
  timezone?: string;
  /** Draw the chart for one simulation, course or learner. */
  scenarioId?: number;
  courseId?: string;
  learnerId?: number;
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

/** TSQ-005 */
export interface PracticeHeatmapData {
  /** Seven rows, Monday first; eight columns of three hours, midnight first. */
  cells: number[][];
  sessions: number;
  /** The time zone the hours are in. */
  timezone: string;
}

/** TSQ-006 */
export interface SessionLengthData {
  /** Counts per band; `boundsMinutes` are the upper limits of every band but the last. */
  bins: number[];
  boundsMinutes: number[];
  sessions: number;
  medianMinutes: number | null;
}

/** TSQ-011 */
export interface ActivationData {
  stages: Array<{
    key: "registered" | "started" | "practisedThreeTimes" | "activeRecently";
    count: number;
  }>;
}

/** TSQ-012 */
export interface RegularityData {
  regular: number;
  occasional: number;
  bursty: number;
  total: number;
  weeks: number;
}

/** TSQ-018 */
export interface ItemFormatData {
  rows: Array<{ type: string; reached: number; completed: number; completedPercent: number }>;
}

/** TSQ-019 */
export interface QuizPassData {
  rows: Array<{ title: string; attempts: number; passRatePercent: number }>;
}

/** TSQ-024 */
export interface SkillChangeData {
  /** Weakest latest level first. */
  rows: Array<{ skill: string; first: number; latest: number; learners: number }>;
}

export interface GetStatisticsScopeOptionsRequest {
  kind: StatisticsScopeKind;
  search?: string;
}

/** TSQ-041 and TSQ-063: a card of named numbers. */
export interface MeasureRow {
  key: string;
  value: number | null;
  /** How the page writes the number. */
  format: "count" | "days" | "minutes" | "score" | "percent" | "date";
  /** A `date` is ISO text; `value` is then null. */
  text?: string | null;
}

export interface MeasuresData {
  measures: MeasureRow[];
}

/** TSQ-043 */
export interface TimeToFinishData {
  /** Counts per band; `boundsDays` are the upper limits of every band but the last. */
  bins: number[];
  boundsDays: number[];
  completed: number;
  medianDays: number | null;
}

/** TSQ-064 */
export interface LearnerCoursesData {
  rows: Array<{
    courseId: string;
    title: string;
    completedItems: number;
    totalItems: number;
    status: "completed" | "inProgress" | "notStarted";
    lastActivityAt: string | null;
  }>;
}
