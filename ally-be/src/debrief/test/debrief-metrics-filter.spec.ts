import {
  metricsFilterSql,
  parseMetricsFilter,
} from '../util/debrief-metrics-filter.util';

/** One filter set for every live metric; malformed values never reach SQL. */
describe('metrics filter', () => {
  it('keeps well-formed values for all six filters', () => {
    expect(
      parseMetricsFilter({
        tenantId: '5FDABF9A-37b2-440d-bdb2-af4f8ce37794',
        language: 'hi-IN',
        learnerLevel: 'EARLY_PROFESSIONAL',
        recipe: 'standard',
        releaseVersion: '5',
        judgeVersion: 'gemini-2.5-pro/v3+g1',
      }),
    ).toEqual({
      tenantId: '5fdabf9a-37b2-440d-bdb2-af4f8ce37794',
      language: 'hi-IN',
      learnerLevel: 'early_professional',
      recipe: 'standard',
      releaseVersion: 5,
      judgeVersion: 'gemini-2.5-pro/v3+g1',
    });
  });

  it('drops anything malformed, including an injection attempt', () => {
    expect(
      parseMetricsFilter({
        tenantId: "x' OR 1=1 --",
        language: "en'; DROP TABLE debrief_runs; --",
        learnerLevel: 'admin',
        recipe: 'anything',
        releaseVersion: '1.5',
        judgeVersion: "a/b' OR '1'='1",
      }),
    ).toEqual({});
  });

  it('renders each filter as a condition on the run, the learner or the judge stamp', () => {
    const sql = metricsFilterSql({
      tenantId: '5fdabf9a-37b2-440d-bdb2-af4f8ce37794',
      language: 'ta-IN',
      learnerLevel: 'lay',
      recipe: 'short',
      releaseVersion: 5,
      judgeVersion: 'gemini-2.5-pro/v3',
    });
    expect(sql).toContain(
      `r.tenant_id = '5fdabf9a-37b2-440d-bdb2-af4f8ce37794'`,
    );
    expect(sql).toContain(`r.language = 'ta-IN'`);
    expect(sql).toContain(
      `lower(COALESCE(u.metadata->>'workerType', 'LAY')) = 'lay'`,
    );
    expect(sql).toContain(`r."recipeKey" = 'short'`);
    expect(sql).toContain(`r."releaseVersion" = 5`);
    expect(sql).toContain(`= 'gemini-2.5-pro/v3'`);
    expect(sql.startsWith(' AND ')).toBe(true);
    expect(metricsFilterSql({})).toBe('');
  });
});
