/**
 * Tenant Statistics chart library: the full catalogue of charts a tenant admin
 * can put on their own dashboard.
 *
 * ## What this is
 * One entry per chart: every chart from the Google Doc ("Dashboard for Admins /
 * Supervisors_Upgrade": Org, Course and Learner tabs) and every chart from the
 * research. Each has a stable id (`TSQ-001`), the question it answers, the SHAPE
 * of the data it returns, where it came from (`sources`), and whether it is
 * built. It mirrors the platform-admin chart registry
 * (`admin-analytics-chart-registry.constants.ts`, `AAQ-###`): one checked-in
 * source of truth in ally-be, served read-only at
 * `GET /v1/tenant-analytics/chart-library` (live charts only), with the frontend
 * registry keyed by the same id. The two must stay in sync.
 *
 * ## Status of an entry
 * - `live: true`   built and offered in the library drawer.
 * - `live: false`, no `blockedBy`   planned: buildable from data we hold, not
 *   built yet. Not offered.
 * - `blockedBy` set   cannot be built until something outside the chart exists
 *   (a seat model, targets, a decision). Not offered. The text says what.
 *
 * ## Conventions
 * - Ids are never reused or renumbered. 1 to 27 are the first-release set; new
 *   charts append. A chart removed after review is listed in
 *   {@link RETIRED_TENANT_CHARTS} with why, so its id is never taken again.
 * - The SHAPE decides the chart: each shape allows a short list of chart types
 *   ({@link SHAPE_ALLOWED_CHARTS}) and the first is the default. A test fails if
 *   an entry's `chart` is not allowed for its `shape`.
 * - `needs` is the data an organisation must have. Met in full = `available`;
 *   below that but at or above each requirement's `sparseMin` = `sparse` (counts
 *   instead of percentages or spreads); otherwise `unavailable`. Declare it only
 *   where the requirement is known: a chart with none is always selectable and is
 *   processed when chosen.
 * - `scopes` says what the chart can be drawn for: the whole `organisation`, one
 *   `course`, one `simulation` or one `learner`. A question asked at several scopes is ONE entry.
 *   Only the organisation scope is built so far; course and learner scopes need
 *   a course or learner picker on the page.
 * - Score-based charts use the judged composite score (0 to 100), which is
 *   comparable across scenarios and sessions. `scenario_sessions.score` is a
 *   running points total that differs by scenario, so it is not used.
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

/** Where a chart came from. */
export type ChartSource = 'doc' | 'research' | 'existing';

/** What a chart is about. */
export type ChartScope = 'organisation' | 'course' | 'simulation' | 'learner';

/** A filter a card can offer: one course, one simulation or one learner. */
export type ChartFilterKey = Exclude<ChartScope, 'organisation'>;

export interface ChartFilter {
  key: ChartFilterKey;
  /** The card cannot be drawn without a choice, because it has no all-organisation view. */
  required: boolean;
}

/**
 * The filters a card offers, read from the scopes it really supports. A scope
 * other than `organisation` is a filter; it is required when `organisation` is
 * not among the scopes (the card has no unfiltered view).
 */
export const filtersOf = (scopes: readonly ChartScope[]): ChartFilter[] =>
  scopes
    .filter((k): k is ChartFilterKey => k !== 'organisation')
    .map((key) => ({ key, required: !scopes.includes('organisation') }));

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
  /**
   * Where the chart came from: the Google Doc, the research, or the page that
   * exists today. A chart can have more than one.
   */
  sources: readonly ChartSource[];
  /** What the chart can be drawn for. One chart serves every scope it lists. */
  scopes: readonly ChartScope[];
  /** Data the organisation must have. Empty = always selectable. */
  needs: readonly ChartRequirement[];
  /**
   * `all`, or the tenant ids that may see this chart. A chart built for one
   * organisation ships to it first and opens to all later.
   */
  visibility: 'all' | readonly string[];
  /** true = built and offered. false = planned or blocked: the id is reserved. */
  live: boolean;
  /** Why the chart cannot be built yet, when it depends on something outside it. */
  blockedBy?: string;
}

type EntryInput = Omit<TenantChartEntry, 'chart' | 'visibility'> &
  Partial<Pick<TenantChartEntry, 'visibility'>>;

const entry = (input: EntryInput): TenantChartEntry => ({
  visibility: 'all',
  ...input,
  chart: SHAPE_ALLOWED_CHARTS[input.shape][0],
});

/**
 * The catalogue, after a review for duplicates and for sense.
 */
export const TENANT_CHART_LIBRARY: readonly TenantChartEntry[] = [
  entry({
    id: 'TSQ-001',
    title: 'Headline numbers',
    question: 'How is our organisation using Ally in this period?',
    group: 'activity',
    shape: 'single_number',
    size: 'wide',
    sources: ['existing', 'doc'],
    scopes: ['organisation'],
    needs: [],
    live: true,
  }),
  entry({
    id: 'TSQ-002',
    title: 'Usage over time',
    question: 'Is usage growing or falling?',
    group: 'activity',
    shape: 'rate_over_time',
    size: 'm',
    sources: ['existing', 'doc'],
    scopes: ['organisation'],
    needs: [{ signal: 'weeksWithActivity90', min: 4, sparseMin: 1 }],
    live: true,
  }),
  entry({
    id: 'TSQ-003',
    title: 'Most-used simulations',
    question: 'Which simulations do learners practise most?',
    group: 'activity',
    shape: 'ranking',
    size: 'm',
    sources: ['existing'],
    scopes: ['organisation', 'course'],
    needs: [],
    live: true,
  }),
  entry({
    id: 'TSQ-005',
    title: 'Practice by weekday and hour',
    question: 'When do learners practise?',
    group: 'activity',
    shape: 'two_category_matrix',
    size: 'm',
    sources: ['research'],
    scopes: ['organisation'],
    needs: [{ signal: 'sessions90', min: 50, sparseMin: 10 }],
    live: true,
  }),
  entry({
    id: 'TSQ-006',
    title: 'Session length',
    question: 'How long are practice sessions?',
    group: 'activity',
    shape: 'distribution',
    size: 'm',
    sources: ['research'],
    scopes: ['organisation'],
    needs: [{ signal: 'sessions90', min: 10, sparseMin: 1 }],
    live: true,
  }),
  entry({
    id: 'TSQ-007',
    title: 'Learner status',
    question: 'How are learners using Ally right now?',
    group: 'learners',
    shape: 'parts_of_whole',
    size: 'wide',
    sources: ['doc'],
    scopes: ['organisation'],
    needs: [],
    live: true,
  }),
  entry({
    id: 'TSQ-008',
    title: 'Top learners',
    question: 'Who are the top learners?',
    group: 'learners',
    shape: 'ranking',
    size: 'm',
    sources: ['doc'],
    scopes: ['organisation'],
    needs: [],
    live: true,
  }),
  entry({
    id: 'TSQ-009',
    title: 'Learner table',
    question: 'What has each learner done?',
    group: 'learners',
    shape: 'multi_measure_rows',
    size: 'wide',
    sources: ['existing'],
    scopes: ['organisation'],
    needs: [],
    live: true,
  }),
  entry({
    id: 'TSQ-011',
    title: 'Activation funnel',
    question:
      'How many new learners get from sign-up to regular practice, and do they come back?',
    group: 'learners',
    shape: 'stage_funnel',
    size: 'm',
    sources: ['research'],
    scopes: ['organisation'],
    needs: [],
    live: true,
  }),
  entry({
    id: 'TSQ-012',
    title: 'Regular and bursty practice',
    question: 'Who practises regularly, and who in bursts?',
    group: 'learners',
    shape: 'parts_of_whole',
    size: 'm',
    sources: ['research'],
    scopes: ['organisation'],
    needs: [{ signal: 'weeksWithActivity90', min: 4, sparseMin: 1 }],
    live: true,
  }),
  entry({
    id: 'TSQ-013',
    title: 'Course table',
    question: 'How is each course going?',
    group: 'courses',
    shape: 'multi_measure_rows',
    size: 'wide',
    sources: ['existing', 'doc'],
    scopes: ['organisation'],
    needs: [{ signal: 'courseEnrolments', min: 1 }],
    live: true,
  }),
  entry({
    id: 'TSQ-014',
    title: 'Courses in use and idle',
    question: 'Which courses are in use, and which are sitting idle?',
    group: 'courses',
    shape: 'parts_of_whole',
    size: 'm',
    sources: ['doc'],
    scopes: ['organisation'],
    needs: [{ signal: 'courseEnrolments', min: 1 }],
    live: true,
  }),
  entry({
    id: 'TSQ-015',
    title: 'Stalled learners per course',
    question: 'Where are learners stuck?',
    group: 'courses',
    shape: 'ranking',
    size: 'm',
    sources: ['doc'],
    scopes: ['organisation'],
    needs: [{ signal: 'courseEnrolments', min: 1 }],
    live: true,
  }),
  entry({
    id: 'TSQ-016',
    title: 'Assigned but never started',
    question: 'Who has been given a course but not begun it?',
    group: 'courses',
    shape: 'ranking',
    size: 'm',
    sources: ['research'],
    scopes: ['organisation'],
    needs: [{ signal: 'courseEnrolments', min: 1 }],
    live: true,
  }),
  entry({
    id: 'TSQ-017',
    title: 'Course completion funnel',
    question: 'Where do learners drop off in a course?',
    group: 'courses',
    shape: 'stage_funnel',
    size: 'm',
    sources: ['doc'],
    scopes: ['organisation'],
    needs: [{ signal: 'courseEnrolments', min: 5, sparseMin: 1 }],
    live: true,
  }),
  entry({
    id: 'TSQ-018',
    title: 'Drop-off by item format',
    question: 'Which kinds of course item lose learners?',
    group: 'courses',
    shape: 'stage_funnel',
    size: 'm',
    sources: ['research'],
    scopes: ['organisation', 'course'],
    needs: [{ signal: 'courseEnrolments', min: 5, sparseMin: 1 }],
    live: true,
  }),
  entry({
    id: 'TSQ-019',
    title: 'Quiz pass rate',
    question: 'Which quizzes do learners struggle with?',
    group: 'courses',
    shape: 'ranking',
    size: 'm',
    sources: ['research'],
    scopes: ['organisation', 'course'],
    needs: [{ signal: 'scoredQuizItems', min: 10, sparseMin: 1 }],
    live: true,
  }),
  entry({
    id: 'TSQ-020',
    title: 'Session scores',
    question: 'How do session scores spread?',
    group: 'outcomes',
    shape: 'distribution',
    size: 'm',
    sources: ['research'],
    scopes: ['organisation', 'course', 'simulation'],
    needs: [{ signal: 'scoredSessions90', min: 10, sparseMin: 1 }],
    live: true,
  }),
  entry({
    id: 'TSQ-021',
    title: 'Improving, holding or declining',
    question: 'Which learners are getting better?',
    group: 'outcomes',
    shape: 'parts_of_whole',
    size: 'm',
    sources: ['research'],
    scopes: ['organisation'],
    needs: [
      { signal: 'learnersWithRepeatScoredSessions', min: 5, sparseMin: 1 },
    ],
    live: true,
  }),
  entry({
    id: 'TSQ-022',
    title: 'Hardest and easiest scenarios',
    question: 'Which scenarios are hardest?',
    group: 'outcomes',
    shape: 'ranking',
    size: 'm',
    sources: ['research', 'doc'],
    scopes: ['organisation', 'course'],
    needs: [{ signal: 'scoredSessions90', min: 10, sparseMin: 1 }],
    live: true,
  }),
  entry({
    id: 'TSQ-023',
    title: 'Learners who need attention',
    question: 'Which learners may need attention?',
    group: 'outcomes',
    shape: 'multi_measure_rows',
    size: 'm',
    sources: ['research'],
    scopes: ['organisation'],
    needs: [],
    live: true,
  }),
  entry({
    id: 'TSQ-024',
    title: 'Skills before and after',
    question:
      'Are learners getting better at the skills, and which are weakest?',
    group: 'outcomes',
    shape: 'before_after',
    size: 'm',
    sources: ['doc'],
    scopes: ['organisation', 'learner'],
    needs: [
      { signal: 'skillScoredCuts', min: 10, sparseMin: 1 },
      { signal: 'skillScoredLearners', min: 5, sparseMin: 1 },
    ],
    live: true,
  }),
  entry({
    id: 'TSQ-026',
    title: 'Ratings and comments',
    question: 'What do learners think of their sessions?',
    group: 'learner_voice',
    shape: 'free_text',
    size: 'm',
    sources: ['doc'],
    scopes: ['organisation', 'course', 'simulation'],
    needs: [{ signal: 'ratings', min: 10, sparseMin: 1 }],
    live: true,
  }),
  entry({
    id: 'TSQ-027',
    title: 'Sessions reviewed',
    question: 'Are submitted sessions getting reviewed?',
    group: 'reviews',
    shape: 'single_number',
    size: 's',
    sources: ['doc'],
    scopes: ['organisation'],
    needs: [{ signal: 'reviews', min: 1 }],
    live: true,
  }),
  entry({
    id: 'TSQ-029',
    title: 'Seats in use',
    question: 'How many seats are filled, and how are they being used?',
    group: 'learners',
    shape: 'parts_of_whole',
    size: 'wide',
    sources: ['doc'],
    scopes: ['organisation'],
    needs: [],
    live: false,
    blockedBy: 'Needs a seat or licence count per organisation',
  }),
  entry({
    id: 'TSQ-030',
    title: 'Completion against target',
    question: 'Are we on track against our completion target?',
    group: 'courses',
    shape: 'rate_over_time',
    size: 'm',
    sources: ['doc'],
    scopes: ['organisation', 'course'],
    needs: [],
    live: false,
    blockedBy: 'Needs a completion target path per course',
  }),
  entry({
    id: 'TSQ-034',
    title: 'Review turnaround',
    question: 'How quickly does a shared session get its first comment?',
    group: 'reviews',
    shape: 'single_number',
    size: 's',
    sources: ['doc', 'research'],
    scopes: ['organisation'],
    needs: [{ signal: 'reviews', min: 1 }],
    live: false,
  }),
  entry({
    id: 'TSQ-035',
    title: 'Reviewers falling behind',
    question: 'Which reviewers are falling behind?',
    group: 'reviews',
    shape: 'ranking',
    size: 'm',
    sources: ['doc'],
    scopes: ['organisation'],
    needs: [],
    live: false,
    blockedBy:
      'Needs sessions assigned to reviewers and a waiting-time measure',
  }),
  entry({
    id: 'TSQ-036',
    title: 'Skills by course',
    question: 'Which skills does each course build, and where are we weak?',
    group: 'outcomes',
    shape: 'two_category_matrix',
    size: 'wide',
    sources: ['doc'],
    scopes: ['organisation', 'course'],
    needs: [{ signal: 'scoredSessions90', min: 10, sparseMin: 1 }],
    live: false,
  }),
  entry({
    id: 'TSQ-037',
    title: 'Peer benchmark',
    question: 'How do we compare with similar organisations?',
    group: 'outcomes',
    shape: 'number_vs_total',
    size: 'wide',
    sources: ['doc'],
    scopes: ['organisation'],
    needs: [],
    live: false,
    blockedBy:
      'Needs enough organisations to anonymise, and an agreed set of measures',
  }),
  entry({
    id: 'TSQ-038',
    title: 'Courses by status',
    question: 'How many courses do we have, and how many are live?',
    group: 'courses',
    shape: 'single_number',
    size: 'wide',
    sources: ['doc'],
    scopes: ['organisation'],
    needs: [],
    live: true,
  }),
  entry({
    id: 'TSQ-039',
    title: 'Course participation',
    question: 'How many learners are on courses right now?',
    group: 'courses',
    shape: 'single_number',
    size: 'wide',
    sources: ['doc'],
    scopes: ['organisation'],
    needs: [{ signal: 'courseEnrolments', min: 1 }],
    live: true,
  }),
  entry({
    id: 'TSQ-040',
    title: 'Summary in a sentence or two',
    question: 'How is this course or learner doing, in a sentence or two?',
    group: 'courses',
    shape: 'free_text',
    size: 'wide',
    sources: ['doc'],
    scopes: ['course', 'learner'],
    needs: [],
    live: false,
    blockedBy: 'Needs a course health tag and a generated summary',
  }),
  entry({
    id: 'TSQ-041',
    title: 'Course facts',
    question: 'What is this course, and who has taken it?',
    group: 'courses',
    shape: 'multi_measure_rows',
    size: 'wide',
    sources: ['doc'],
    scopes: ['course'],
    needs: [{ signal: 'courseEnrolments', min: 1 }],
    live: false,
  }),
  entry({
    id: 'TSQ-042',
    title: 'Course performance since launch',
    question:
      'How has the course performed since launch, and how many have completed?',
    group: 'courses',
    shape: 'rate_over_time',
    size: 'wide',
    sources: ['doc'],
    scopes: ['organisation', 'course'],
    needs: [{ signal: 'courseEnrolments', min: 5, sparseMin: 1 }],
    live: true,
  }),
  entry({
    id: 'TSQ-043',
    title: 'Time to finish a course',
    question: 'How long does this course take to finish?',
    group: 'courses',
    shape: 'distribution',
    size: 'm',
    sources: ['doc', 'research'],
    scopes: ['organisation', 'course'],
    needs: [{ signal: 'courseCompletions', min: 5, sparseMin: 1 }],
    live: true,
  }),
  entry({
    id: 'TSQ-044',
    title: 'Later cohorts against earlier',
    question: 'Have later cohorts done better than earlier ones?',
    group: 'courses',
    shape: 'multi_measure_rows',
    size: 'wide',
    sources: ['doc'],
    scopes: ['course'],
    needs: [],
    live: false,
    blockedBy: 'Needs a definition of a course cohort',
  }),
  entry({
    id: 'TSQ-045',
    title: 'Module funnel',
    question: 'At which module do learners drop off, in every course?',
    group: 'courses',
    shape: 'stage_funnel',
    size: 'm',
    sources: ['doc'],
    scopes: ['course'],
    needs: [{ signal: 'courseEnrolments', min: 5, sparseMin: 1 }],
    live: true,
  }),
  entry({
    id: 'TSQ-046',
    title: 'Time per module',
    question: 'How long does each module take?',
    group: 'courses',
    shape: 'ranking',
    size: 'm',
    sources: ['doc'],
    scopes: ['course'],
    needs: [{ signal: 'courseEnrolments', min: 5, sparseMin: 1 }],
    live: true,
  }),
  entry({
    id: 'TSQ-047',
    title: 'Module difficulty',
    question:
      'Which modules are easiest and which are hardest, and do learners get through the hard ones?',
    group: 'courses',
    shape: 'ranking',
    size: 'm',
    sources: ['doc'],
    scopes: ['course'],
    needs: [],
    live: false,
    blockedBy: 'Needs a difficulty tag on each module',
  }),
  entry({
    id: 'TSQ-049',
    title: 'Score with a new character',
    question: 'Can they do it with someone new?',
    group: 'outcomes',
    shape: 'value_by_step',
    size: 'm',
    sources: ['doc'],
    scopes: ['course'],
    needs: [{ signal: 'scoredSessions90', min: 10, sparseMin: 1 }],
    live: false,
  }),
  entry({
    id: 'TSQ-050',
    title: 'Helpful behaviours before and after',
    question: 'Which helpful behaviours became more common?',
    group: 'outcomes',
    shape: 'before_after',
    size: 'm',
    sources: ['doc'],
    scopes: ['course'],
    needs: [{ signal: 'skillScoredCuts', min: 10, sparseMin: 1 }],
    live: false,
  }),
  entry({
    id: 'TSQ-051',
    title: 'Unhelpful responses over time',
    question: 'Did unhelpful responses go down?',
    group: 'outcomes',
    shape: 'before_after',
    size: 'm',
    sources: ['doc'],
    scopes: ['organisation', 'course', 'learner'],
    needs: [{ signal: 'skillScoredCuts', min: 10, sparseMin: 1 }],
    live: false,
  }),
  entry({
    id: 'TSQ-053',
    title: 'Roleplay length and attempts',
    question:
      'How long does each roleplay take, and how many attempts before passing?',
    group: 'outcomes',
    shape: 'ranking',
    size: 'm',
    sources: ['doc'],
    scopes: ['organisation', 'course'],
    needs: [{ signal: 'scoredSessions90', min: 10, sparseMin: 1 }],
    live: true,
  }),
  entry({
    id: 'TSQ-055',
    title: 'Score by attempt number',
    question: 'Do learners improve with repeated attempts?',
    group: 'outcomes',
    shape: 'value_by_step',
    size: 'm',
    sources: ['doc', 'research'],
    scopes: ['organisation'],
    needs: [
      { signal: 'learnersWithRepeatScoredSessions', min: 5, sparseMin: 1 },
    ],
    live: false,
  }),
  entry({
    id: 'TSQ-058',
    title: 'Early and later words',
    question: 'What does the improvement sound like?',
    group: 'outcomes',
    shape: 'free_text',
    size: 'm',
    sources: ['doc'],
    scopes: ['course', 'learner'],
    needs: [],
    live: false,
    blockedBy: 'Quotes come from session transcripts: needs a privacy decision',
  }),
  entry({
    id: 'TSQ-059',
    title: 'Feedback themes',
    question: 'What do learners think, and what are they asking for?',
    group: 'learner_voice',
    shape: 'free_text',
    size: 'm',
    sources: ['doc'],
    scopes: ['organisation'],
    needs: [],
    live: false,
    blockedBy:
      'Needs theme analysis of comments and journals, and a privacy decision',
  }),
  entry({
    id: 'TSQ-062',
    title: 'Learner profile',
    question: 'Who is this, and what are they enrolled in?',
    group: 'learners',
    shape: 'multi_measure_rows',
    size: 'wide',
    sources: ['doc'],
    scopes: ['learner'],
    needs: [],
    live: false,
    blockedBy: 'Needs supervisor data; groups exist but supervisors do not',
  }),
  entry({
    id: 'TSQ-063',
    title: 'Practice rhythm',
    question: 'How much have they practised, and how regularly?',
    group: 'learners',
    shape: 'multi_measure_rows',
    size: 'wide',
    sources: ['doc'],
    scopes: ['organisation', 'learner'],
    needs: [],
    live: true,
  }),
  entry({
    id: 'TSQ-064',
    title: 'Progress in each course',
    question: 'Where are they in each course?',
    group: 'learners',
    shape: 'multi_measure_rows',
    size: 'wide',
    sources: ['doc'],
    scopes: ['learner'],
    needs: [{ signal: 'courseEnrolments', min: 1 }],
    live: false,
  }),
  entry({
    id: 'TSQ-065',
    title: 'Skill trend',
    question: 'Are they getting better at each skill?',
    group: 'outcomes',
    shape: 'value_by_step',
    size: 'wide',
    sources: ['doc'],
    scopes: ['organisation', 'learner'],
    needs: [{ signal: 'skillScoredCuts', min: 10, sparseMin: 1 }],
    live: true,
  }),
  entry({
    id: 'TSQ-066',
    title: 'Behaviours against the group',
    question: 'Which helpful behaviours do they use, and which are missing?',
    group: 'outcomes',
    shape: 'before_after',
    size: 'm',
    sources: ['doc'],
    scopes: ['learner'],
    needs: [{ signal: 'skillScoredCuts', min: 10, sparseMin: 1 }],
    live: false,
  }),
  entry({
    id: 'TSQ-070',
    title: 'Sessions waiting for review',
    question: 'Which sessions are waiting for review, oldest first?',
    group: 'reviews',
    shape: 'multi_measure_rows',
    size: 'm',
    sources: ['doc'],
    scopes: ['organisation', 'learner'],
    needs: [{ signal: 'reviews', min: 1 }],
    live: false,
  }),
  entry({
    id: 'TSQ-072',
    title: 'Readiness',
    question: 'Are they ready to move on?',
    group: 'outcomes',
    shape: 'number_vs_total',
    size: 'm',
    sources: ['doc'],
    scopes: ['learner'],
    needs: [],
    live: false,
    blockedBy: 'Needs a readiness threshold per skill',
  }),
  entry({
    id: 'TSQ-073',
    title: 'Practice-time mix',
    question:
      'How is practice time spread across light, regular and heavy learners?',
    group: 'learners',
    shape: 'parts_of_whole',
    size: 'm',
    sources: ['research'],
    scopes: ['organisation'],
    needs: [],
    live: false,
  }),
  entry({
    id: 'TSQ-076',
    title: 'Dropped off and came back',
    question: 'Who dropped off this month, and who came back?',
    group: 'learners',
    shape: 'parts_of_whole',
    size: 'm',
    sources: ['research'],
    scopes: ['organisation'],
    needs: [],
    live: false,
  }),
  entry({
    id: 'TSQ-078',
    title: 'Stalled enrolment age',
    question: 'How long have stalled learners been stuck?',
    group: 'courses',
    shape: 'distribution',
    size: 'm',
    sources: ['research'],
    scopes: ['organisation'],
    needs: [{ signal: 'courseEnrolments', min: 1 }],
    live: false,
  }),
  entry({
    id: 'TSQ-080',
    title: 'Low-rated session tags',
    question: 'What do low ratings get tagged with?',
    group: 'learner_voice',
    shape: 'ranking',
    size: 'm',
    sources: ['research'],
    scopes: ['organisation'],
    needs: [{ signal: 'ratings', min: 10, sparseMin: 1 }],
    live: false,
  }),
  entry({
    id: 'TSQ-082',
    title: 'Feedback uptake',
    question: 'Do learners act on the feedback they are given?',
    group: 'outcomes',
    shape: 'before_after',
    size: 'm',
    sources: ['research'],
    scopes: ['organisation', 'learner'],
    needs: [{ signal: 'reviews', min: 1 }],
    live: false,
  }),
];

/**
 * Charts removed from the catalogue after review, with why. An id here is never
 * reused. Where a chart was merged, the surviving entry lists all its scopes.
 */
export const RETIRED_TENANT_CHARTS: Record<string, string> = {
  'TSQ-004': 'Covered by the change notes on the headline tiles (TSQ-001).',
  'TSQ-010':
    'Same data as the learner status bar (TSQ-007), split a little finer.',
  'TSQ-025':
    'Covered by Skills before and after (TSQ-024), sorted weakest first.',
  'TSQ-028': 'Merged into Seats in use (TSQ-029).',
  'TSQ-031':
    'Merged into Completion against target (TSQ-030), which gains a course choice.',
  'TSQ-032':
    'A health tag is a column of the course table (TSQ-013), added once targets exist.',
  'TSQ-033':
    'Merged into Module funnel (TSQ-045), which can show every course side by side.',
  'TSQ-048': 'Merged into Module difficulty (TSQ-047).',
  'TSQ-052':
    'A table view of Hardest and easiest scenarios (TSQ-022), added as columns there.',
  'TSQ-054':
    'Merged into Skills by course (TSQ-036), which can show roleplays within a course.',
  'TSQ-056':
    'Merged into Session scores (TSQ-020), which gains a by-roleplay view.',
  'TSQ-057':
    'A slope view of Improving, holding or declining (TSQ-021), added there later.',
  'TSQ-060':
    'Clinician checks are not held per organisation; platform quality, not an admin decision.',
  'TSQ-061': 'Merged into Summary in a sentence or two (TSQ-040).',
  'TSQ-067': 'Merged into Unhelpful responses over time (TSQ-051).',
  'TSQ-068': 'Merged into Early and later words (TSQ-058).',
  'TSQ-069': 'Merged into Feedback uptake (TSQ-082).',
  'TSQ-071': 'Merged into Ratings and comments (TSQ-026).',
  'TSQ-074':
    'XP ladder position is a gamification detail, not an admin decision; the learner table shows level.',
  'TSQ-075':
    'Merged into Activation funnel (TSQ-011), which ends at still active.',
  'TSQ-077': 'Merged into Course performance since launch (TSQ-042).',
  'TSQ-079':
    'Competencies and helping skills overlap; skills are covered by TSQ-024.',
  'TSQ-081':
    'Product quality of the debrief, not an admin decision; tracked in the platform console.',
};

/** `tenants.settings` path that turns the new Statistics page on for one tenant. */
export const STATISTICS_DASHBOARD_SETTINGS_KEY = 'statisticsDashboard';
