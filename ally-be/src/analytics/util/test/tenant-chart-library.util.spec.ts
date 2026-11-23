import {
  CHART_SHAPES,
  SHAPE_ALLOWED_CHARTS,
  TENANT_CHART_LIBRARY,
} from '../../constants/tenant-chart-library.constants';
import {
  TenantCapabilities,
  isChartVisibleToTenant,
  resolveChartAvailability,
  validateChartLibrary,
} from '../tenant-chart-library.util';

const none: TenantCapabilities = {
  learners: 0,
  activeLearners90: 0,
  sessions90: 0,
  scoredSessions90: 0,
  learnersWithRepeatScoredSessions: 0,
  ratings: 0,
  weeksWithActivity90: 0,
  courseEnrolments: 0,
  courseCompletions: 0,
  scoredQuizItems: 0,
  reviews: 0,
  cohorts: 0,
  skillScoredCuts: 0,
  skillScoredLearners: 0,
};

describe('tenant chart library registry', () => {
  it('is sound: unique sequential ids and every chart allowed for its shape', () => {
    expect(validateChartLibrary()).toEqual([]);
  });

  it('holds the 27 Release 1 charts', () => {
    expect(TENANT_CHART_LIBRARY).toHaveLength(27);
  });

  it('allows at least one chart type for every shape', () => {
    CHART_SHAPES.forEach((shape) => {
      expect(SHAPE_ALLOWED_CHARTS[shape].length).toBeGreaterThan(0);
    });
  });

  it('reports a chart that is not allowed for its shape', () => {
    const bad = [{ ...TENANT_CHART_LIBRARY[0], chart: 'heatmap' as const }];
    expect(validateChartLibrary(bad)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('not allowed for shape'),
      ]),
    );
  });

  it('reports a duplicate or out-of-sequence id', () => {
    const dupe = [TENANT_CHART_LIBRARY[0], TENANT_CHART_LIBRARY[0]];
    const problems = validateChartLibrary(dupe);
    expect(problems.some((p) => p.includes('duplicate id'))).toBe(true);
    expect(problems.some((p) => p.includes('sequential'))).toBe(true);
  });
});

describe('resolveChartAvailability', () => {
  const byId = (id: string) => TENANT_CHART_LIBRARY.find((c) => c.id === id)!;

  it('is always available when a chart needs nothing', () => {
    expect(resolveChartAvailability(byId('TSQ-001'), none)).toEqual({
      state: 'available',
      reason: null,
    });
    expect(resolveChartAvailability(byId('TSQ-009'), none).state).toBe(
      'available',
    );
  });

  it('is available when the requirement is met in full', () => {
    // TSQ-020 session scores: needs 10 scored sessions, sparse from 1.
    const r = resolveChartAvailability(byId('TSQ-020'), {
      ...none,
      scoredSessions90: 10,
    });
    expect(r.state).toBe('available');
  });

  it('is sparse between sparseMin and min', () => {
    const r = resolveChartAvailability(byId('TSQ-020'), {
      ...none,
      scoredSessions90: 4,
    });
    expect(r.state).toBe('sparse');
    expect(r.reason).toContain('counts only');
    expect(r.reason).toContain('at least 10');
    expect(r.reason).toContain('you have 4');
  });

  it('is unavailable below sparseMin, with the reason', () => {
    const r = resolveChartAvailability(byId('TSQ-020'), none);
    expect(r.state).toBe('unavailable');
    expect(r.reason).toBe(
      'Needs at least 10 scored sessions in the last 90 days (you have 0).',
    );
  });

  it('has no sparse state when a requirement has no sparseMin', () => {
    // TSQ-013 course table: needs 1 enrolment, no sparse band.
    const r = resolveChartAvailability(byId('TSQ-013'), none);
    expect(r.state).toBe('unavailable');
    expect(r.reason).toContain('1 course enrolment');
    expect(
      resolveChartAvailability(byId('TSQ-013'), {
        ...none,
        courseEnrolments: 1,
      }).state,
    ).toBe('available');
  });

  it('needs every requirement: one hard miss makes it unavailable', () => {
    // TSQ-024 skills before/after: 10 cuts AND 5 learners.
    const r = resolveChartAvailability(byId('TSQ-024'), {
      ...none,
      skillScoredCuts: 40,
      skillScoredLearners: 0,
    });
    expect(r.state).toBe('unavailable');
    expect(r.reason).toContain('learners with skill scores');
  });
});

describe('isChartVisibleToTenant', () => {
  it('shows an `all` chart to everyone', () => {
    expect(isChartVisibleToTenant({ visibility: 'all' }, 't1')).toBe(true);
  });
  it('limits an allow-listed chart to its tenants', () => {
    expect(isChartVisibleToTenant({ visibility: ['t1'] }, 't1')).toBe(true);
    expect(isChartVisibleToTenant({ visibility: ['t1'] }, 't2')).toBe(false);
  });
});
