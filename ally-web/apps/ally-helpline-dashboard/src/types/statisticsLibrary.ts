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

/** What a chart can be drawn for. */
export type StatisticsChartScope = "organisation" | "course" | "simulation" | "learner";

/** A filter a card can offer: one course, one simulation or one learner. */
export type StatisticsFilterKey = Exclude<StatisticsChartScope, "organisation">;

export interface StatisticsChartFilter {
  key: StatisticsFilterKey;
  /** The card has no unfiltered view, so a choice is required. */
  required: boolean;
}

/** The filters set on a card, by filter key: the id of the course, simulation or learner. */
export type StatisticsFilterValues = Partial<Record<StatisticsFilterKey, string>>;

export interface StatisticsScopeOption {
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
  /** The tab the chart belongs on. */
  home: StatisticsViewId;
  shape: string;
  chart: string;
  size: StatisticsChartSize;
  /** What the chart can be drawn for; always lists the whole organisation. */
  scopes: StatisticsChartScope[];
  /** The filters the card offers. */
  filters: StatisticsChartFilter[];
  state: StatisticsChartState;
  /** Why the chart is sparse or unavailable; null when available. */
  reason: string | null;
}

/** The tabs of the page that show charts. */
export type StatisticsViewId = "organisation" | "course" | "learner";

export interface StatisticsViewSection {
  /** Translation key under `statisticsLibrary.sections`. */
  key: string;
  /** Drawn for the course or learner chosen on the view rather than the whole organisation. */
  subject: boolean;
  charts: string[];
}

export interface StatisticsViewConfig {
  id: StatisticsViewId;
  /** What the view asks you to choose, or null when it is about the whole organisation. */
  subject: StatisticsFilterKey | null;
  sections: StatisticsViewSection[];
  /** The layout before a person customises, in section order. */
  defaultLayout: string[];
}

export interface StatisticsChartLibrary {
  /** Whether the new page is switched on for this tenant. */
  enabled: boolean;
  charts: StatisticsChartEntry[];
  /** The tabs that show charts. Absent from a backend older than the tabs. */
  views?: StatisticsViewConfig[];
  /** Chart ids pinned to For you until the person pins their own. */
  defaultPins?: string[];
}

export interface StatisticsChartResponse<T = unknown> {
  id: string;
  /** Every filter the chart was drawn with, with names. */
  filters?: Array<{ kind: StatisticsFilterKey; id: string; label: string }>;
  state: Exclude<StatisticsChartState, "unavailable">;
  data: T;
}

export interface GetStatisticsChartRequest {
  id: string;
  range?: OrganizationMetricsRange;
  /** IANA time zone, for charts that group by time of day. */
  timezone?: string;
  /** Filters, as the API takes them. */
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

/** TSQ-042 */
export interface CoursePerformanceData {
  weeks: Array<{ week: string; started: number; completed: number }>;
  enrolled: number;
  completed: number;
}

export interface GetStatisticsScopeOptionsRequest {
  kind: StatisticsFilterKey;
  search?: string;
  /** Describe this one option instead of listing. */
  id?: string;
}

/** TSQ-043 */
export interface TimeToFinishData {
  bins: number[];
  boundsDays: number[];
  completed: number;
  medianDays: number | null;
}

/** TSQ-045 */
export interface ModuleFunnelData {
  rows: Array<{ sectionId: string; title: string; reached: number; completed: number }>;
}

/** TSQ-046 */
export interface ModuleTimeData {
  rows: Array<{ sectionId: string; title: string; medianMinutes: number; learners: number }>;
}

/** TSQ-053 */
export interface RoleplayAttemptsData {
  rows: Array<{
    itemId: string;
    title: string;
    courseTitle: string | null;
    learners: number;
    averageAttempts: number | null;
    averageMinutes: number | null;
  }>;
}

/** TSQ-065 */
export interface SkillTrendData {
  skills: Array<{ skill: string; points: Array<{ slice: number; level: number }> }>;
}

/** TSQ-049 */
export interface NewCharacterData {
  learners: number;
  pairs: number;
  /** Helping-skills level (1 to 4) with a familiar character; null while under the floor. */
  familiar: number | null;
  unfamiliar: number | null;
  change: number | null;
  up: number;
  down: number;
  same: number;
}

/** TSQ-050 */
export interface HelpfulBehavioursData {
  learners: number;
  rows: Array<{
    code: string;
    skill: string;
    text: string;
    beforePercent: number;
    afterPercent: number;
  }>;
}

/** TSQ-051 */
export interface UnhelpfulTrendData {
  points: Array<{ slice: number; sharePercent: number; assessments: number }>;
}

/** TSQ-055 */
export interface ScoreByAttemptData {
  steps: Array<{ attempt: number; learners: number; averageScore: number }>;
}

/** One finding on For you: what a rule found in the organisation's own charts. */
export interface StatisticsInsight {
  /** Names the finding and the week it was found in; used to put it away. */
  fingerprint: string;
  /** The rule. The sentence is written from it, in the reader's language. */
  ruleId: string;
  polarity: "attention" | "celebrate";
  severity: number;
  /** The numbers and names the sentence is written from. */
  params: Record<string, string | number>;
  /** The chart the finding comes from, and the tab it is on. */
  chartId: string;
  view: StatisticsViewId;
  /** The course or learner that shows the finding, when it is about one. */
  filters?: Partial<Record<StatisticsFilterKey, string>>;
}

export interface StatisticsInsights {
  attention: StatisticsInsight[];
  celebrate: StatisticsInsight[];
}

export interface UpdateStatisticsInsightStateRequest {
  fingerprint: string;
  state: "done" | "snoozed";
  /** How many days "snoozed" hides it. */
  days?: number;
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

/** Why Ally staff might get in touch with an organisation (Customers tab). */
export type CustomerReasonId =
  | "neverActive"
  | "quiet"
  | "neverStarted"
  | "activityDown"
  | "reviewsBehind"
  | "creditsNearLimit"
  | "lowRating"
  | "activityUp";

export interface CustomerReason {
  id: CustomerReasonId;
  polarity: "attention" | "celebrate";
  severity: number;
  /** The numbers the sentence is written from. */
  params: Record<string, number>;
}

export interface CustomerOrgRow {
  tenantId: string;
  name: string;
  code: string | null;
  learners: number;
  activeLearners28d: number;
  completedLast28d: number;
  completedPrev28d: number;
  lastCompletedAt: string | null;
  daysSinceLastCompleted: number | null;
  /** Completed sessions per week, on the shared axis. */
  trend: number[];
  creditUtilisationPct: number | null;
  ratingsAverage90d: number | null;
  ratingsCount90d: number;
  reviewSharePercent: number | null;
  neverStartedLearners: number;
  belowFloor: boolean;
  reasons: CustomerReason[];
  score: number;
  contactedAt: string | null;
  contactNote: string | null;
  recentlyContacted: boolean;
}

export interface CustomerMover {
  tenantId: string;
  name: string;
  from: number;
  to: number;
}

export interface CustomerOverview {
  generatedAt: string;
  trendBuckets: string[];
  summary: { orgs: number; activeOrgs: number; quietOrgs: number; needsOutreach: number };
  orgs: CustomerOrgRow[];
  movers: { up: CustomerMover[]; down: CustomerMover[] };
}

export interface RecordCustomerOutreachRequest {
  tenantId: string;
  note?: string;
}
