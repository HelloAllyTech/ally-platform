import {
  metricsFilterSql,
  pageFilter,
  parseMetricsFilter,
  SESSION_LENGTH_BANDS,
} from '../util/debrief-metrics-filter.util';
import { lengthBand } from '../util/debrief-metrics.util';

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

  it('keeps the six segment filters: skill, scenario, course, session length, step model, risk', () => {
    expect(
      parseMetricsFilter({
        skill: 'Open questions',
        scenarioId: '42',
        courseId: '7',
        sessionLength: '16-30',
        stepModel: 'safety_reader: gemini-3-flash-preview',
        risk: 'no_risk',
      }),
    ).toEqual({
      skill: 'Open questions',
      scenarioId: 42,
      courseId: 7,
      sessionLength: '16-30',
      stepModel: 'safety_reader: gemini-3-flash-preview',
      risk: 'no_risk',
    });
    expect(
      parseMetricsFilter({
        skill: 'a\u0000b',
        scenarioId: '1 OR 1=1',
        courseId: '-3',
        sessionLength: '0-99',
        stepModel: "writer: x'; DROP TABLE x; --",
        risk: 'maybe',
      }),
    ).toEqual({});
  });

  it('renders the segment filters, escaping the free-text skill', () => {
    const sql = metricsFilterSql({
      skill: "Client's feelings",
      scenarioId: 42,
      courseId: 7,
      sessionLength: '31+',
      stepModel: 'writer: gemini-3-flash-preview',
      risk: 'risk',
    });
    expect(sql).toContain(`k.sk = 'Client''s feelings'`);
    expect(sql).toContain(`s."scenarioId" = 42`);
    expect(sql).toContain(`ti."trackId" = 7`);
    expect(sql).toContain(`r."learnerTurns" >= 31`);
    expect(sql).not.toContain(`r."learnerTurns" <=`);
    expect(sql).toContain(`st->>'step' = 'writer'`);
    expect(sql).toContain(`st->>'model' = 'gemini-3-flash-preview'`);
    expect(sql).toContain(`r."hasRiskCue" IS TRUE`);
    expect(metricsFilterSql({ sessionLength: '6-15' })).toBe(
      ` AND r."learnerTurns" >= 6 AND r."learnerTurns" <= 15`,
    );
  });

  it('uses the same session-length bands as the breakdown', () => {
    for (const b of SESSION_LENGTH_BANDS) {
      expect(lengthBand(Math.max(1, b.min))).toBe(b.band);
      if (b.max != null) expect(lengthBand(b.max)).toBe(b.band);
    }
  });

  it('keeps only the page-wide filters for metrics other than the pass rate', () => {
    expect(
      pageFilter({
        language: 'hi-IN',
        releaseVersion: 5,
        skill: 'x',
        scenarioId: 3,
        risk: 'risk',
      }),
    ).toEqual({ language: 'hi-IN', releaseVersion: 5 });
  });
});
