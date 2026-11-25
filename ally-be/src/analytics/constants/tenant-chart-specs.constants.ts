import { ChartQuerySpec } from '../util/tenant-chart-query.util';

/** A scenario needs this many scored sessions before its average is shown. */
export const SCENARIO_MIN_SESSIONS = 3;
export const SCENARIO_LIMIT = 8;

/**
 * Charts defined as data. Adding a chart of this kind is one entry here and one
 * registry row: no SQL, no handler, no component. Ids match the registry.
 * A chart that does not fit a spec keeps its own handler in the service.
 */
export const TENANT_CHART_SPECS: Readonly<Record<string, ChartQuerySpec>> = {
  // How do session scores spread?
  'TSQ-020': { source: 'sessions', result: 'distribution' },
  // Which simulations do learners practise most? Completed sessions, most first.
  'TSQ-003': {
    source: 'sessions',
    result: 'ranked',
    measure: 'sessions',
    dimension: 'scenario',
    basis: 'completed',
    order: 'desc',
    limit: 5,
  },
  // What do learners think of their sessions?
  'TSQ-026': { source: 'feedback', result: 'stars' },
  // Which scenarios are hardest? Lowest average score first.
  'TSQ-022': {
    source: 'sessions',
    result: 'ranked',
    measure: 'averageScore',
    dimension: 'scenario',
    order: 'asc',
    minSessions: SCENARIO_MIN_SESSIONS,
    limit: SCENARIO_LIMIT,
  },
};

/**
 * Charts with their own handler that still apply a course, simulation or
 * learner filter. A chart not in this set or in {@link TENANT_CHART_SPECS} is
 * organisation-wide, whatever its registry row lists, so it never claims a scope
 * it would ignore.
 */
export const SCOPE_AWARE_CHARTS: ReadonlySet<string> = new Set([
  'TSQ-018', // Drop-off by item format
  'TSQ-019', // Quiz pass rate
  'TSQ-024', // Skills before and after
  'TSQ-041', // Course facts
  'TSQ-043', // Time to finish a course
  'TSQ-042', // Course performance since launch
  'TSQ-045', // Module funnel
  'TSQ-046', // Time per module
  'TSQ-034', // Review turnaround
  'TSQ-036', // Skills by course
  'TSQ-044', // Later cohorts against earlier
  'TSQ-047', // Module difficulty
  'TSQ-049', // Score with a new character
  'TSQ-050', // Helpful behaviours before and after
  'TSQ-051', // Unhelpful responses over time
  'TSQ-053', // Roleplay length and attempts
  'TSQ-062', // Learner profile
  'TSQ-066', // Behaviours against the group
  'TSQ-070', // Sessions waiting for review
  'TSQ-083', // Roleplay performance
  'TSQ-084', // Skills by roleplay
  'TSQ-085', // Score spread by roleplay
  'TSQ-086', // Learner change
  'TSQ-087', // Trust in scores
  'TSQ-088', // Learners across modules
  'TSQ-055', // Score by attempt number
  'TSQ-065', // Skill trend
  'TSQ-063', // Practice rhythm
  'TSQ-064', // Progress in each course
]);
