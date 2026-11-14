import { DebriefPmAgentService } from '../service/debrief-pm-agent.service';
import { DebriefPmReportsService } from '../service/debrief-pm-reports.service';
import { DebriefContextRepository } from '../service/debrief-context.repository';
import {
  istMonth,
  istMonthDays,
  istMonthElapsed,
  periodBounds,
} from '../util/debrief-pm-reports.util';

/**
 * The learning budget, monthly cap and pool all count the month in India
 * time, as Reports do. A replay costing $2 at 2026-11-30T20:00Z is 1 December
 * 01:30 IST, so it is December's spend in the PM agent's Ideas strip and in
 * the Reports budget bar, and not November's in either.
 */
const LATE_NOV_UTC = new Date('2026-11-30T20:00:00Z');

/** A fake Postgres that filters one replay row by the `$1`/`$2` bounds. */
function fakeDb(rows: Array<{ at: Date; usd: number }>) {
  return {
    query: jest.fn(async (sql: string, params: string[] = []) => {
      const from = params[0] ? new Date(params[0]) : null;
      const to = params[1] ? new Date(params[1]) : null;
      const hit = rows.filter(
        (r) => (!from || r.at >= from) && (!to || r.at < to),
      );
      if (/date_trunc\('month'/.test(sql)) {
        throw new Error('month counted with date_trunc (UTC), not IST');
      }
      if (sql.includes('FROM llm_usage')) return [];
      if (sql.includes('"ceilingUsd"')) return [{ ceilings: 0 }];
      if (sql.includes("mode = 'replay'") && sql.includes('count(*)::int')) {
        return [{ n: 0 }];
      }
      if (sql.includes("mode = 'replay'")) {
        return [{ usd: hit.reduce((n, r) => n + r.usd, 0), judged: 0 }];
      }
      return [
        {
          sessions: hit.length,
          spent: hit.reduce((n, r) => n + r.usd, 0),
        },
      ];
    }),
  };
}

describe('the learning-budget month is India time everywhere', () => {
  afterEach(() => jest.useRealTimers());

  it('places 2026-11-30T20:00Z in December (IST)', () => {
    const dec = istMonth(LATE_NOV_UTC);
    expect(dec.from.toISOString()).toBe('2026-11-30T18:30:00.000Z');
    expect(dec.to.toISOString()).toBe('2026-12-31T18:30:00.000Z');
    expect(istMonthDays(LATE_NOV_UTC)).toBe(31);
    expect(istMonthElapsed(new Date('2026-11-30T18:30:00Z'))).toBe(0);
  });

  it('counts it in December in the PM agent strip and in Reports', async () => {
    const rows = [{ at: LATE_NOV_UTC, usd: 2 }];

    // PM agent › Ideas strip, read on 10 December.
    jest.useFakeTimers({ now: new Date('2026-12-10T06:00:00Z') });
    const pm = Object.create(DebriefPmAgentService.prototype) as any;
    Object.assign(pm, { dataSource: fakeDb(rows) });
    expect(await pm.learningSpentThisMonth()).toBe(2);

    // A UTC month would start at 2026-12-01T00:00Z and miss it.
    expect(pm.dataSource.query.mock.calls[0][1]).toEqual([
      '2026-11-30T18:30:00.000Z',
    ]);
    jest.useRealTimers();

    // PM agent › Reports budget bar.
    const reports = Object.create(DebriefPmReportsService.prototype) as any;
    Object.assign(reports, {
      dataSource: fakeDb(rows),
      ownerSettings: {
        get: jest.fn(async () => ({
          learningBudgetUsd: 30,
          learningSkimPct: 0,
        })),
      },
    });
    const dec = periodBounds('monthly', '2026-12');
    const nov = periodBounds('monthly', '2026-11');
    expect((await reports.budget(dec.from, dec.to)).spentUsd).toBe(2);
    expect((await reports.budget(nov.from, nov.to)).spentUsd).toBe(0);
  });

  it('counts the production pool from the IST month start', async () => {
    jest.useFakeTimers({ now: new Date('2026-12-01T03:00:00Z') });
    const repo = Object.create(DebriefContextRepository.prototype) as any;
    Object.assign(repo, { dataSource: fakeDb([{ at: LATE_NOV_UTC, usd: 2 }]) });
    expect(await repo.monthToDate()).toEqual({ sessions: 1, spentUsd: 2 });
  });
});
