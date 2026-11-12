import { DebriefConsoleViewService } from '../service/debrief-console-view.service';
import { parseSessionFilters } from '../util/debrief-console-view.util';

/**
 * Postgres refuses a query whose parameter list holds a value the SQL never
 * references ("could not determine data type of parameter $n"): every
 * category but "To score" used to send the scoring sample unreferenced, so
 * the Debriefs home list answered 500.
 */
describe('DebriefConsoleViewService.sessions parameters', () => {
  const referenced = (sql: string) =>
    new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));

  const make = () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const dataSource = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params: params ?? [] });
        return [];
      }),
    };
    const svc = new (DebriefConsoleViewService as any)(dataSource);
    // No calibration service in this test: the sample is empty.
    svc.scoringSample = async () => ({
      inSample: new Set(['a']),
      ratedByMe: new Set(),
    });
    return { svc, calls };
  };
  const viewer = {
    userId: 1,
    roles: {},
    can: { score: true },
    scorer: true,
  } as any;

  for (const category of [
    'needs',
    'flagged',
    'below',
    'published',
    'escalated',
    'to_score',
    'all',
  ]) {
    it(`references every parameter it sends (${category})`, async () => {
      const { svc, calls } = make();
      await svc.sessions(
        parseSessionFilters({ category, language: 'en-IN' }),
        viewer,
      );
      for (const { sql, params } of calls.filter((c) => c.params.length)) {
        const used = referenced(sql);
        params.forEach((_, i) => expect(used.has(i + 1)).toBe(true));
        expect(Math.max(...used)).toBe(params.length);
      }
    });
  }
});

/**
 * PRD §6.6 [SAFETY]: a flag on an important moment enters the queue at once,
 * as urgent; only other flags wait out the learner's 10-minute undo window.
 */
describe('DebriefConsoleViewService queue: urgent flags skip the undo window', () => {
  it('counts an urgent open flag as work even inside the undo window', async () => {
    const calls: string[] = [];
    const svc = new (DebriefConsoleViewService as any)({
      query: jest.fn(async (sql: string) => {
        calls.push(sql);
        return [];
      }),
    });
    svc.scoringSample = async () => ({
      inSample: new Set(),
      ratedByMe: new Set(),
    });
    await svc.sessions(parseSessionFilters({ category: 'needs' }), {
      userId: 1,
      roles: {},
      can: { score: false },
      scorer: false,
    } as any);
    const sql = calls[0].replace(/\s+/g, ' ');
    expect(sql).toContain(
      `(f.status = 'escalated' OR (f.status = 'open' AND (f.urgent OR f."updatedAt" < now() - make_interval(secs => $1))))`,
    );
  });
});
