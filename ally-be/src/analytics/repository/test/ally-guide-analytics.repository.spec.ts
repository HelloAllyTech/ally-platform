import { AllyGuideAnalyticsRepository } from '../ally-guide-analytics.repository';

/**
 * Week keys must not depend on the server's time zone. A timestamp column
 * comes back from pg as a local-time Date, whose ISO string lands on the
 * previous day east of UTC, so no row would match the service's week labels.
 */
describe('AllyGuideAnalyticsRepository week keys', () => {
  const WEEKLY = [
    'activity',
    'firstWins',
    'items',
    'returns',
    'appointments',
    'quizFirstAttempts',
    'roleplayScores',
    'health',
    'crises',
    'thumbs',
  ] as const;

  it.each(WEEKLY)('%s returns its week as YYYY-MM-DD text', async (name) => {
    const query = jest.fn(async () => [{ week: '2026-10-19' }]);
    const repo = new AllyGuideAnalyticsRepository({ query } as never);
    const rows = (await (repo as any)[name](
      new Date('2026-10-01T00:00:00Z'),
      new Date('2026-10-25T00:00:00Z'),
    )) as Array<{ week: string }>;
    const sql = String((query.mock.calls[0] as unknown[])[0]);
    const outer = sql.slice(sql.lastIndexOf('SELECT'));
    expect(sql).toMatch(/to_char\([^]*?'YYYY-MM-DD'\) AS week/);
    expect(outer).not.toMatch(/SELECT\s+date_trunc\('week'/);
    expect(rows[0].week).toBe('2026-10-19');
  });
});
