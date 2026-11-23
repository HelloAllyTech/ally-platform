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
