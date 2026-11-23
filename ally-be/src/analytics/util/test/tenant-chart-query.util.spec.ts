import {
  compileStars,
  compileDistributionBins,
  compileMedian,
  compileRanked,
  CompileContext,
  RankedSessionSpec,
} from '../tenant-chart-query.util';

const ctx = (scope: CompileContext['scope'] = {}): CompileContext => ({
  tenantId: 'tenant-uuid',
  tenantCode: 'tenantcode',
  start: new Date('2026-01-01'),
  endExclusive: new Date('2026-04-01'),
  scope,
});

const spec: RankedSessionSpec = {
  source: 'sessions',
  result: 'ranked',
  measure: 'averageScore',
  dimension: 'scenario',
  order: 'asc',
  minSessions: 3,
  limit: 8,
};

describe('chart query compiler', () => {
  it('always matches the tenant by both spellings and the window', () => {
    const { sql, params } = compileRanked(spec, ctx());
    expect(sql).toContain('s.tenant_id::text IN ($1, $2)');
    expect(sql).toContain('s."startedAt" >= $3 AND s."startedAt" < $4');
    expect(params.slice(0, 2)).toEqual(['tenant-uuid', 'tenantcode']);
  });

  it('adds no scope filter and no course join for an organisation chart', () => {
    const { sql, params } = compileRanked(spec, ctx());
    expect(sql).not.toContain('track_item_progress');
    expect(sql).not.toContain('counselorId" =');
    expect(params).toHaveLength(4);
  });

  it('passes scope ids as parameters, never in the SQL text', () => {
    const courseId = '8b3f2f0e-1c0a-4d6e-9a53-3d1c0d2f4a11';
    const { sql, params } = compileRanked(
      spec,
      ctx({ courseId, scenarioId: 7, learnerId: 9 }),
    );
    expect(params.slice(4)).toEqual([7, courseId, 9]);
    expect(sql).toContain('s."scenarioId" = $5');
    expect(sql).toContain('ti."trackId" = $6::uuid');
    expect(sql).toContain('s."counselorId" = $7');
    expect(sql).not.toContain(courseId);
    expect(sql).toContain('JOIN track_item_progress');
  });

  it('keeps a hostile string out of the SQL', () => {
    const evil = "x'; DROP TABLE users; --";
    const { sql, params } = compileRanked(spec, ctx({ courseId: evil }));
    expect(sql).not.toContain('DROP TABLE');
    expect(params).toContain(evil);
  });

  it('clamps the limit and the minimum, and orders by the measure', () => {
    const { sql } = compileRanked(
      { ...spec, limit: 99999, minSessions: -4, order: 'desc' },
      ctx(),
    );
    expect(sql).toContain('LIMIT 200');
    expect(sql).toContain('HAVING COUNT(*) >= 1');
    expect(sql).toContain('ORDER BY AVG(d."compositeScore") DESC');
  });

  it('uses the same scoped match for the score bands and the median', () => {
    const scoped = ctx({ scenarioId: 7 });
    [compileDistributionBins(scoped), compileMedian(scoped)].forEach((q) => {
      expect(q.sql).toContain('s."scenarioId" = $5');
      expect(q.params).toEqual([
        'tenant-uuid',
        'tenantcode',
        scoped.start,
        scoped.endExclusive,
        7,
      ]);
    });
  });

  it('counts completed sessions the way the metrics page does', () => {
    const { sql } = compileRanked(
      {
        ...spec,
        measure: 'sessions',
        basis: 'completed',
        order: 'desc',
        limit: 5,
      },
      ctx(),
    );
    expect(sql).toContain(
      `s.status = 'ENDED' AND s."eventStatus" = 'COMPLETED'`,
    );
    expect(sql).toContain('COALESCE(s."endedAt", s."createdAt") >= $3');
    expect(sql).not.toContain('scenario_session_details');
    expect(sql).toContain('ORDER BY COUNT(*) DESC');
  });

  it('defaults a score measure to scored sessions and a count to completed ones', () => {
    expect(compileRanked(spec, ctx()).sql).toContain(
      'scenario_session_details',
    );
    expect(
      compileRanked({ ...spec, measure: 'learners' }, ctx()).sql,
    ).not.toContain('scenario_session_details');
  });

  it('counts stars for the whole organisation without touching sessions', () => {
    const { sql, params } = compileStars(ctx());
    expect(sql).toContain('f.tenant_id::text IN ($1, $2)');
    expect(sql).not.toContain('scenario_sessions');
    expect(params).toHaveLength(4);
  });

  it("reaches a rating's course, simulation and learner through its session", () => {
    const courseId = '8b3f2f0e-1c0a-4d6e-9a53-3d1c0d2f4a11';
    const { sql, params } = compileStars(
      ctx({ courseId, scenarioId: 7, learnerId: 9 }),
    );
    expect(sql).toContain(
      'JOIN scenario_sessions s ON s.id = f."scenarioSessionId"',
    );
    expect(sql).toContain('JOIN track_item_progress');
    expect(params.slice(4)).toEqual([7, courseId, 9]);
    expect(sql).not.toContain(courseId);
  });
});
