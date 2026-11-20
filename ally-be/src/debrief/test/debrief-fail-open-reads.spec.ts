import { DebriefChangeHoldsService } from '../service/debrief-change-holds.service';
import { DebriefGatewayService } from '../service/debrief-gateway.service';

/**
 * Reads that used to fail OPEN without a trace (design review, logic finding 2): a pin that cannot
 * be read must fail the attempt, and rule checks run without the clinical patterns must say so.
 */
describe('a pinned release that cannot be read', () => {
  const build = (getById: jest.Mock) => {
    const dataSource = {
      query: jest.fn(async () => [{ value: 'hi' }]),
      getRepository: () => ({}),
    };
    const holds = {
      findOne: jest.fn(async () => ({ language: 'hi', releaseId: 'rel-old' })),
      find: jest.fn(async () => []),
      create: (x: any) => x,
      save: async (x: any) => x,
      update: jest.fn(),
    };
    const svc = new DebriefChangeHoldsService(
      dataSource as any,
      holds as any,
      { getById } as any,
    );
    // The language lookup is not what this tests.
    (svc as any).sessionLanguage = async () => 'hi';
    (svc as any).activePin = async () => ({ releaseId: 'rel-old' });
    return svc;
  };

  it('throws, so the caller never falls back to the release in force', async () => {
    const svc = build(
      jest.fn(async () => {
        throw new Error('db down');
      }),
    );
    await expect(svc.releaseForSession('s1')).rejects.toThrow('db down');
  });

  it('still returns the pinned release when it can be read, and null when it is gone', async () => {
    const ok = build(
      jest.fn(async () => ({ id: 'rel-old', agentKey: 'debrief' })),
    );
    expect((await ok.releaseForSession('s1'))?.id).toBe('rel-old');
    const gone = build(jest.fn(async () => null));
    expect(await gone.releaseForSession('s1')).toBeNull();
  });
});

describe('rule checks without the clinical patterns', () => {
  const cards: any = {
    opening: 'You helped them open up.',
    important_moment: null,
    what_worked: [],
    work_on_this: [],
    practise_next: null,
  };
  const build = (patterns: jest.Mock | undefined) => {
    const runs = { query: jest.fn(async () => []) };
    const context = {
      transcript: jest.fn(async () => [
        { turn_index: 1, role: 'counselor', text: 'Hello' },
      ]),
    };
    const svc = new DebriefGatewayService(
      runs as any,
      context as any,
      {} as any,
      {} as any,
      patterns ? ({ patterns } as any) : undefined,
    );
    return { svc, runs };
  };
  const run: any = { id: 'run-1', scenarioSessionId: 's1', workspace: {} };

  it('still runs, and leaves a note on the run saying the patterns were missing', async () => {
    const patterns = jest.fn(async () => {
      throw new Error('statement timeout');
    });
    const { svc, runs } = build(patterns);
    const out = await svc.runChecks(run, {
      cards,
      safety: { risk_cues: [], learner_distress: [] } as any,
      language: 'en',
    });
    expect(out).toHaveProperty('failures');
    const [sql, params] = (runs.query.mock.calls as any[][])[0];
    expect(sql).toContain('{dataNotes}');
    expect(JSON.parse(params[1])).toEqual([
      {
        contextKey: 'clinical_patterns',
        item: null,
        why: 'statement timeout',
      },
    ]);
  });

  it('leaves no note when the patterns were read, or when the service is absent', async () => {
    const ok = build(jest.fn(async () => undefined));
    await ok.svc.runChecks(run, {
      cards,
      safety: { risk_cues: [], learner_distress: [] } as any,
      language: 'en',
    });
    expect(ok.runs.query).not.toHaveBeenCalled();
    const absent = build(undefined);
    await absent.svc.runChecks(run, {
      cards,
      safety: { risk_cues: [], learner_distress: [] } as any,
      language: 'en',
    });
    expect(absent.runs.query).not.toHaveBeenCalled();
  });
});
