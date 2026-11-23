/**
 * Tenant Statistics chart library — the canonical list of charts a tenant admin
 * can put on their own dashboard.
 *
 * ## What this is
 * Every chart has a stable id (`TSQ-001`, flat and sequential), the question it
 * answers, the SHAPE of the data it returns, and the data an organisation must
 * have before the chart is worth showing. It mirrors the platform-admin chart
 * registry (`admin-analytics-chart-registry.constants.ts`, `AAQ-###`): one
 * checked-in source of truth in ally-be, served read-only at
 * `GET /v1/tenant-analytics/chart-library`, with the frontend registry keyed by
 * the same id. The two must stay in sync.
 *
 * ## Conventions
 * - Ids are never reused or renumbered. A retired chart is removed and a comment
 *   left in its place.
 * - The SHAPE decides the chart: each shape allows a short list of chart types
 *   ({@link SHAPE_ALLOWED_CHARTS}) and the first is the default. A test fails if
 *   an entry's `chart` is not allowed for its `shape`.
 * - `needs` is the data an organisation must have. Met in full = `available`;
 *   below that but at or above each requirement's `sparseMin` = `sparse` (counts
 *   instead of percentages or spreads); otherwise `unavailable`.
 * - `live: false` charts are planned: they hold their id but are not offered
 *   until a handler exists.
 * - Score-based charts use the learner's own score (`scenario_sessions.score`),
 *   never the judge's `compositeScore`.
 */

export const CHART_GROUPS = [
  'activity',
  'learners',
  'courses',
  'outcomes',
  'learner_voice',
  'reviews',
] as const;
export type ChartGroup = (typeof CHART_GROUPS)[number];

export const CHART_SHAPES = [
  'single_number',
  'number_vs_total',
  'rate_over_time',
  'count_per_period',
  'running_total',
  'parts_of_whole',
  'ranking',
  'multi_measure_rows',
  'distribution',
  'two_category_matrix',
  'stage_funnel',
  'before_after',
  'value_by_step',
  'free_text',
] as const;
export type ChartShape = (typeof CHART_SHAPES)[number];

export const CHART_TYPES = [
  'tile',
  'meter',
  'bullet',
  'line',
  'bar',
  'area',
  'stacked_bar',
  'donut',
  'ranked_bar',
  'table',
  'histogram',
  'boxplot',
  'heatmap',
  'funnel',
  'slope',
  'list',
] as const;
export type ChartType = (typeof CHART_TYPES)[number];

/** The data shape decides the chart. The first entry is the default. */
export const SHAPE_ALLOWED_CHARTS: Record<ChartShape, readonly ChartType[]> = {
  single_number: ['tile'],
  number_vs_total: ['meter', 'bullet'],
  rate_over_time: ['line'],
  count_per_period: ['bar'],
  running_total: ['area'],
  parts_of_whole: ['stacked_bar', 'donut'],
  ranking: ['ranked_bar'],
  multi_measure_rows: ['table'],
  distribution: ['histogram', 'boxplot'],
  two_category_matrix: ['heatmap'],
  stage_funnel: ['funnel'],
  before_after: ['slope'],
  value_by_step: ['line'],
  free_text: ['list'],
};

/** Cheap counts for one tenant that decide which charts it can fill. */
export const CAPABILITY_SIGNALS = [
  'learners',
  'activeLearners90',
  'sessions90',
  'scoredSessions90',
  'learnersWithRepeatScoredSessions',
  'ratings',
  'weeksWithActivity90',
  'courseEnrolments',
  'courseCompletions',
  'scoredQuizItems',
  'reviews',
  'cohorts',
  'skillScoredCuts',
  'skillScoredLearners',
] as const;
export type CapabilitySignal = (typeof CAPABILITY_SIGNALS)[number];

/** Human wording for a signal, used in "Needs at least N …" reasons. */
export const CAPABILITY_LABELS: Record<
  CapabilitySignal,
  { singular: string; plural: string }
> = {
  learners: { singular: 'learner', plural: 'learners' },
  activeLearners90: {
    singular: 'active learner in the last 90 days',
    plural: 'active learners in the last 90 days',
  },
  sessions90: {
    singular: 'session in the last 90 days',
    plural: 'sessions in the last 90 days',
  },
  scoredSessions90: {
    singular: 'scored session in the last 90 days',
    plural: 'scored sessions in the last 90 days',
  },
  learnersWithRepeatScoredSessions: {
    singular: 'learner with two or more scored sessions',
    plural: 'learners with two or more scored sessions',
  },
  ratings: { singular: 'session rating', plural: 'session ratings' },
  weeksWithActivity90: {
    singular: 'week with activity in the last 90 days',
    plural: 'weeks with activity in the last 90 days',
  },
  courseEnrolments: {
    singular: 'course enrolment',
    plural: 'course enrolments',
  },
  courseCompletions: {
    singular: 'course completion',
    plural: 'course completions',
  },
  scoredQuizItems: {
    singular: 'scored quiz item',
    plural: 'scored quiz items',
  },
  reviews: { singular: 'session review', plural: 'session reviews' },
  cohorts: { singular: 'group', plural: 'groups' },
  skillScoredCuts: {
    singular: 'skill-scored practice slice',
    plural: 'skill-scored practice slices',
  },
  skillScoredLearners: {
    singular: 'learner with skill scores',
    plural: 'learners with skill scores',
  },
};

export interface ChartRequirement {
  signal: CapabilitySignal;
  /** At or above this the requirement is met in full. */
  min: number;
  /** At or above this (but below `min`) the chart is `sparse`. Absent: no sparse state. */
  sparseMin?: number;
}

export type ChartSize = 's' | 'm' | 'wide';

export interface TenantChartEntry {
  /** Stable id, `TSQ-001`. Never reused, never renumbered. */
  id: string;
  title: string;
  /** The question the chart answers, shown in the library drawer. */
  question: string;
  group: ChartGroup;
  shape: ChartShape;
  /** Must be allowed for `shape`. */
  chart: ChartType;
  size: ChartSize;
  /** Data the organisation must have. Empty = always available. */
  needs: readonly ChartRequirement[];
  /**
   * `all`, or the tenant ids that may see this chart. A chart built for one
   * organisation ships to it first and opens to all later.
   */
  visibility: 'all' | readonly string[];
  /** false = planned: the id is reserved, the chart is not offered yet. */
  live: boolean;
}

const e = (
  id: number,
  title: string,
  question: string,
  group: ChartGroup,
  shape: ChartShape,
  size: ChartSize,
  needs: readonly ChartRequirement[] = [],
  live = false,
): TenantChartEntry => ({
  id: `TSQ-${String(id).padStart(3, '0')}`,
  title,
  question,
  group,
  shape,
  chart: SHAPE_ALLOWED_CHARTS[shape][0],
  size,
  needs,
  visibility: 'all',
  live,
});

const req = (
  signal: CapabilitySignal,
  min: number,
  sparseMin?: number,
): ChartRequirement => ({ signal, min, sparseMin });

/**
 * Release 1 library: the 27 charts that clear "at least a third of active
 * organisations meet the minimum". Planned entries (`live` omitted) are filled
 * in as their handlers land; see TENANT_STATS_DESIGN.md section 11.
 */
export const TENANT_CHART_LIBRARY: readonly TenantChartEntry[] = [
  // ── Activity ───────────────────────────────────────────────
  e(
    1,
    'Headline numbers',
    'How is our organisation using Ally in this period?',
    'activity',
    'single_number',
    'wide',
    [],
    true,
  ),
  e(
    2,
    'Usage over time',
    'Is usage growing or falling?',
    'activity',
    'rate_over_time',
    'm',
    [req('weeksWithActivity90', 4, 1)],
    true,
  ),
  e(
    3,
    'Most-used simulations',
    'Which simulations do learners practise most?',
    'activity',
    'ranking',
    'm',
    [],
    true,
  ),
  e(
    4,
    'Active learners against the previous period',
    'Are more or fewer learners practising than before?',
    'activity',
    'single_number',
    's',
    [req('weeksWithActivity90', 2)],
  ),
  e(
    5,
    'Practice by weekday and hour',
    'When do learners practise?',
    'activity',
    'two_category_matrix',
    'm',
    [req('sessions90', 50, 10)],
  ),
  e(
    6,
    'Session length',
    'How long are practice sessions?',
    'activity',
    'distribution',
    'm',
    [req('sessions90', 10, 1)],
  ),
  // ── Learners ───────────────────────────────────────────────
  e(
    7,
    'Learner status',
    'How are learners using Ally right now?',
    'learners',
    'parts_of_whole',
    'wide',
    [],
    true,
  ),
  e(
    8,
    'Top learners',
    'Who are the top learners?',
    'learners',
    'ranking',
    'm',
    [],
    true,
  ),
  e(
    9,
    'Learner table',
    'What has each learner done?',
    'learners',
    'multi_measure_rows',
    'wide',
    [],
    true,
  ),
  e(
    10,
    'Days since last activity',
    'How long since each learner last practised?',
    'learners',
    'distribution',
    'm',
  ),
  e(
    11,
    'Activation funnel',
    'How many learners get from sign-up to regular practice?',
    'learners',
    'stage_funnel',
    'm',
  ),
  e(
    12,
    'Regular and bursty practice',
    'Who practises regularly, and who in bursts?',
    'learners',
    'parts_of_whole',
    'm',
    [req('weeksWithActivity90', 4, 1)],
  ),
  // ── Courses ────────────────────────────────────────────────
  e(
    13,
    'Course table',
    'How is each course going?',
    'courses',
    'multi_measure_rows',
    'wide',
    [req('courseEnrolments', 1)],
    true,
  ),
  e(
    14,
    'Courses in use and idle',
    'Which courses are in use, and which are sitting idle?',
    'courses',
    'parts_of_whole',
    'm',
    [req('courseEnrolments', 1)],
  ),
  e(
    15,
    'Stalled learners per course',
    'Where are learners stuck?',
    'courses',
    'ranking',
    'm',
    [req('courseEnrolments', 1)],
  ),
  e(
    16,
    'Assigned but never started',
    'Who has been given a course but not begun it?',
    'courses',
    'ranking',
    'm',
    [req('courseEnrolments', 1)],
  ),
  e(
    17,
    'Course completion funnel',
    'Where do learners drop off in a course?',
    'courses',
    'stage_funnel',
    'm',
    [req('courseEnrolments', 5, 1)],
  ),
  e(
    18,
    'Drop-off by item format',
    'Which kinds of course item lose learners?',
    'courses',
    'stage_funnel',
    'm',
    [req('courseEnrolments', 5, 1)],
  ),
  e(
    19,
    'Quiz pass rate',
    'Which quizzes do learners struggle with?',
    'courses',
    'ranking',
    'm',
    [req('scoredQuizItems', 10, 1)],
  ),
  // ── Outcomes ───────────────────────────────────────────────
  e(
    20,
    'Session scores',
    'How do session scores spread?',
    'outcomes',
    'distribution',
    'm',
    [req('scoredSessions90', 10, 1)],
  ),
  e(
    21,
    'Improving, holding or declining',
    'Which learners are getting better?',
    'outcomes',
    'parts_of_whole',
    'm',
    [req('learnersWithRepeatScoredSessions', 5, 1)],
  ),
  e(
    22,
    'Hardest and easiest scenarios',
    'Which scenarios are hardest?',
    'outcomes',
    'ranking',
    'm',
    [req('scoredSessions90', 10, 1)],
  ),
  e(
    23,
    'Learners who need attention',
    'Which learners may need attention?',
    'outcomes',
    'multi_measure_rows',
    'm',
    [],
    true,
  ),
  e(
    24,
    'Skills before and after',
    'Are learners getting better at the skills?',
    'outcomes',
    'before_after',
    'm',
    [req('skillScoredCuts', 10, 1), req('skillScoredLearners', 5, 1)],
  ),
  e(
    25,
    'Weakest helping skills',
    'Which skills are weakest across the organisation?',
    'outcomes',
    'ranking',
    'm',
    [req('skillScoredCuts', 10, 1), req('skillScoredLearners', 5, 1)],
  ),
  // ── Learner voice ──────────────────────────────────────────
  e(
    26,
    'Ratings and comments',
    'What do learners think of their sessions?',
    'learner_voice',
    'free_text',
    'm',
    [req('ratings', 10, 1)],
  ),
  // ── Reviews ────────────────────────────────────────────────
  e(
    27,
    'Sessions reviewed',
    'Are submitted sessions getting reviewed?',
    'reviews',
    'single_number',
    's',
    [req('reviews', 1)],
  ),
];

/** `tenants.settings` path that turns the new Statistics page on for one tenant. */
export const STATISTICS_DASHBOARD_SETTINGS_KEY = 'statisticsDashboard';
