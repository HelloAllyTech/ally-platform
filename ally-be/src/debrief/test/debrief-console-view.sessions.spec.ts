import {
  blindStatus,
  blindSteps,
  DebriefConsoleViewService,
} from '../service/debrief-console-view.service';
import { parseSessionFilters } from '../util/debrief-console-view.util';

/**
 * Postgres refuses a query whose parameter list holds a value the SQL never
 * references ("could not determine data type of parameter $n"): every
 * category but "To score" used to send the scoring sample unreferenced, so
 * the Debriefs home list answered 500.
 */
describe('DebriefConsoleViewService.sessions parameters', () => {
  it('an old "to_score" link falls back to Needs a person (Score by hand is gone)', () => {
    expect(parseSessionFilters({ category: 'to_score' }).category).toBe(
      'needs',
    );
  });

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
    return { svc, calls };
  };
  const viewer = {
    userId: 1,
    roles: {},
    can: { verdict: true },
  } as any;

  for (const category of [
    'needs',
    'flagged',
    'below',
    'published',
    'escalated',
    'agreement_sample',
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
    await svc.sessions(parseSessionFilters({ category: 'needs' }), {
      userId: 1,
      roles: {},
      can: {},
    } as any);
    const sql = calls[0].replace(/\s+/g, ' ');
    expect(sql).toContain(
      `(f.status = 'escalated' OR (f.status = 'open' AND (f.urgent OR f."updatedAt" < now() - make_interval(secs => $1))))`,
    );
  });
});

/** Spec Q3: the clinical advisor gives a verdict before seeing the judge's scores. */
describe('DebriefConsoleViewService list: advisor blinding', () => {
  const row = (id: string) => ({
    id,
    scenarioSessionId: `s-${id}`,
    rank: 4,
    judgeOverall: '9.5',
    evaluatorOverall: '9.1',
    mode: 'live',
    status: 'published',
    fallbackRung: 0,
  });
  const make = () =>
    new (DebriefConsoleViewService as any)({
      query: jest.fn(async (sql: string) => {
        if (sql.includes('"runId" = ANY')) return [{ runId: 'b' }];
        if (sql.includes('SELECT * FROM ranked')) return [row('a'), row('b')];
        if (sql.includes('count(*) FILTER')) return [{}];
        return [];
      }),
    });

  it('hides both scores on runs the advisor has not given a verdict on', async () => {
    const out = await make().sessions(
      parseSessionFilters({ category: 'published' }),
      { userId: 902, roles: { clinicalAdvisor: true }, can: { verdict: true } },
    );
    const byId = Object.fromEntries(out.items.map((i: any) => [i.runId, i]));
    expect(byId.a).toMatchObject({
      judgeOverall: null,
      evaluatorOverall: null,
    });
    expect(byId.b).toMatchObject({ judgeOverall: 9.5, evaluatorOverall: 9.1 });
  });

  it('the Ally team and the owner always see them', async () => {
    const out = await make().sessions(
      parseSessionFilters({ category: 'published' }),
      { userId: 6, roles: { allyTeam: true, owner: true }, can: {} },
    );
    expect(out.items.map((i: any) => i.judgeOverall)).toEqual([9.5, 9.5]);
  });
});

/** Spec Q3: nor any other hint of the checks' result, such as "Below the bar". */
describe('DebriefConsoleViewService list: advisor blind to "below the bar"', () => {
  const below = (id: string, status: string, rank: number) => ({
    id,
    scenarioSessionId: `s-${id}`,
    rank,
    judgeOverall: '6.5',
    evaluatorOverall: '7.1',
    mode: 'live',
    status,
    judge_below: true,
    fallbackRung: 0,
    createdAt: new Date('2026-11-12T10:00:00Z'),
  });
  const sqls: string[] = [];
  const make = () =>
    new (DebriefConsoleViewService as any)({
      query: jest.fn(async (sql: string) => {
        sqls.push(sql);
        if (sql.includes('"runId" = ANY')) return [{ runId: 'mine' }];
        if (sql.includes('SELECT * FROM ranked'))
          return [
            below('bar', 'below_bar', 2),
            below('judged', 'published', 2),
            below('held', 'needs_person', 2),
            below('mine', 'below_bar', 2),
          ];
        if (sql.includes('count(*) FILTER')) return [{ below: 3 }];
        return [];
      }),
    });
  const advisor = {
    userId: 902,
    roles: { clinicalAdvisor: true },
    can: { verdict: true },
  };

  it('reads a below-the-bar run as published, out of the queue, until the verdict', async () => {
    const out = await make().sessions(
      parseSessionFilters({ category: 'all' }),
      advisor,
    );
    const byId = Object.fromEntries(out.items.map((i: any) => [i.runId, i]));
    for (const id of ['bar', 'judged']) {
      expect(byId[id]).toMatchObject({
        status: 'published',
        belowBar: false,
        needsPerson: false,
        rank: 3,
        waitingSince: null,
      });
    }
    // Held is not a check's result the advisor is blind to: it stays held.
    expect(byId.held).toMatchObject({
      status: 'needs_person',
      needsPerson: true,
    });
    // After their verdict they see it as it is.
    expect(byId.mine).toMatchObject({ status: 'below_bar', belowBar: true });
    expect(out.counts.below).toBeNull();
  });

  it('gives the advisor no "Below the bar" list', async () => {
    sqls.length = 0;
    await make().sessions(parseSessionFilters({ category: 'below' }), advisor);
    expect(sqls.find((q) => q.includes('SELECT * FROM ranked'))).toMatch(
      /WHERE false/,
    );
  });

  it("keeps below-the-bar runs out of the advisor's Needs a person list, count and order", async () => {
    sqls.length = 0;
    await make().sessions(parseSessionFilters({ category: 'needs' }), advisor);
    const counts = sqls.find((q) => q.includes('count(*) FILTER'))!;
    const list = sqls.find((q) => q.includes('SELECT * FROM ranked'))!;
    expect(counts).toContain('FILTER (WHERE blind_rank < 3)::int AS needs');
    expect(list).toMatch(/WHERE blind_rank < 3\s+ORDER BY blind_rank ASC/);
    // A held or failed run still waits for a person.
    expect(list).toContain(
      `CASE WHEN rank = 2 AND status NOT IN ('needs_person','failed') THEN 3`,
    );
    sqls.length = 0;
    await make().sessions(parseSessionFilters({ category: 'needs' }), {
      userId: 6,
      roles: { allyTeam: true },
      can: {},
    });
    expect(sqls.find((q) => q.includes('SELECT * FROM ranked'))).toMatch(
      /WHERE rank < 3\s+ORDER BY rank ASC/,
    );
  });

  it('the Ally team still sees it', async () => {
    const out = await make().sessions(
      parseSessionFilters({ category: 'all' }),
      { userId: 6, roles: { allyTeam: true }, can: {} },
    );
    expect(out.items[0]).toMatchObject({ status: 'below_bar', belowBar: true });
    expect(out.counts.below).toBe(3);
  });
});

describe('blindStatus / blindSteps', () => {
  it("hide the Evaluator's score and the below-the-bar status only when blind", () => {
    const steps = [
      { step: 'writer', output: 'no important moment' },
      { step: 'evaluator', output: '6.8 overall; 1 hard fail', reasoning: 'x' },
    ];
    expect(blindSteps(steps, true)).toEqual([
      steps[0],
      { step: 'evaluator', output: null, reasoning: undefined },
    ]);
    expect(blindSteps(steps, false)).toBe(steps);
    expect(blindStatus('below_bar')).toBe('published');
    expect(blindStatus('needs_person')).toBe('needs_person');
  });
});
