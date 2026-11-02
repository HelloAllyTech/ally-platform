import { ForbiddenException } from '@nestjs/common';
import {
  DebriefAgentService,
  LIVE_START_DELAY_MS,
} from '../service/debrief-agent.service';

function build(opts: {
  owner?: number;
  live?: boolean;
  runs?: Array<Record<string, unknown>>;
  endedMinutesAgo?: number;
  profile?: Record<string, unknown> | null;
}) {
  const ended = new Date(Date.now() - (opts.endedMinutesAgo ?? 10) * 60_000);
  const dataSource = {
    query: jest.fn(async (sql: string) =>
      sql.includes('guide_org_profiles')
        ? opts.profile
          ? [{ profile: opts.profile }]
          : []
        : [
            {
              counselor_id: opts.owner ?? 7,
              tenant_id: 't1',
              status: 'ENDED',
              ended_at: ended,
            },
          ],
    ),
  };
  const runs = { find: jest.fn(async () => opts.runs ?? []) };
  const overrides = {
    get: jest.fn(async () =>
      opts.live === false ? null : { values: { live: true } },
    ),
  };
  return new DebriefAgentService(
    dataSource as any,
    runs as any,
    {} as any,
    {} as any,
    {} as any,
    overrides as any,
    { debriefAgentMode: 'shadow' } as any,
    {
      available: jest.fn(async (_u: number, _t: string, ids: number[]) =>
        ids
          .filter((id) => id === 41)
          .map((id) => ({ id, title: 'Exam stress' })),
      ),
    } as any,
  );
}

describe('DebriefAgentService.learnerView', () => {
  it('refuses anyone but the learner who did the session', async () => {
    await expect(
      build({ owner: 9 }).learnerView('s', 7),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps today’s debrief when the organisation is not switched on', async () => {
    expect(await build({ live: false }).learnerView('s', 7)).toEqual({
      state: 'not_available',
    });
  });

  it('serves a published live debrief, cards only', async () => {
    const view = await build({
      runs: [
        {
          mode: 'live',
          status: 'published',
          cards: { opening: 'x' },
          language: 'hi',
          steps: [],
        },
      ],
    }).learnerView('s', 7);
    expect(view).toEqual({
      state: 'ready',
      cards: { opening: 'x' },
      language: 'hi',
      distress: false,
      supportLines: expect.any(Array),
      practice: [],
    });
  });

  it('gives Tele-MANAS when the organisation set no support lines', async () => {
    const view = await build({
      runs: [
        {
          mode: 'live',
          status: 'published',
          cards: {},
          language: 'hi-IN',
          steps: [],
        },
      ],
    }).learnerView('s', 7);
    expect(view.supportLines?.[0]).toMatchObject({
      phone: '14416',
      isCrisis: true,
    });
  });

  it('gives the organisation’s own lines, in the debrief’s language', async () => {
    const view = await build({
      profile: {
        supportLines: {
          en: [{ name: 'Org line (en)', phone: '111' }],
          hi: [{ name: 'Org line (hi)', phone: '222' }],
        },
      },
      runs: [
        {
          mode: 'live',
          status: 'published',
          cards: {},
          language: 'hi-IN',
          steps: [],
        },
      ],
    }).learnerView('s', 7);
    expect(view.supportLines).toEqual([
      { name: 'Org line (hi)', phone: '222' },
    ]);
  });

  it('says when the learner was in distress, so support comes first', async () => {
    const view = await build({
      runs: [
        {
          mode: 'live',
          status: 'published',
          cards: {},
          language: 'en',
          steps: [],
          learnerDistress: true,
        },
      ],
    }).learnerView('s', 7);
    expect(view.distress).toBe(true);
  });

  it('is working only while the drain will still pick the session up', async () => {
    expect((await build({}).learnerView('s', 7)).state).toBe('working');
    expect(
      (await build({ endedMinutesAgo: 60 * 72 }).learnerView('s', 7)).state,
    ).toBe('not_available');
    expect(
      (
        await build({
          runs: [{ mode: 'shadow', status: 'published' }],
        }).learnerView('s', 7)
      ).state,
    ).toBe('not_available');
  });

  it('a run a person must finish reads as on its way', async () => {
    expect(
      (
        await build({
          runs: [{ mode: 'live', status: 'needs_person', steps: [] }],
        }).learnerView('s', 7)
      ).state,
    ).toBe('on_its_way');
  });
});

describe('DebriefAgentService.onSessionEnded', () => {
  const make = (live: boolean, mode: 'off' | 'shadow' = 'shadow') => {
    const runner = {
      run: jest.fn(async () => ({
        id: 'r',
        status: 'published',
        fallbackRung: 0,
        cards: null,
      })),
    };
    const releases = { syncSeed: jest.fn() };
    const overrides = {
      get: jest.fn(async () => (live ? { values: { live: true } } : null)),
    };
    const svc = new DebriefAgentService(
      {} as any,
      {} as any,
      runner as any,
      { judge: jest.fn() } as any,
      releases as any,
      overrides as any,
      { debriefAgentMode: mode } as any,
    );
    return { svc, runner };
  };
  const event = {
    scenarioSessionId: 's1',
    tenantId: 't1',
    userId: 7,
    date: new Date(),
    durationMinutes: 4,
  };

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('starts a live debrief shortly after a switched-on session ends', async () => {
    const { svc, runner } = make(true);
    await svc.onSessionEnded(event);
    expect(runner.run).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(LIVE_START_DELAY_MS);
    expect(runner.run).toHaveBeenCalledWith('s1', { mode: 'live' });
  });

  it('leaves shadow organisations to the drain, and does nothing when switched off', async () => {
    for (const [live, mode] of [
      [false, 'shadow'],
      [true, 'off'],
    ] as const) {
      const { svc, runner } = make(live, mode);
      await svc.onSessionEnded(event);
      await jest.advanceTimersByTimeAsync(LIVE_START_DELAY_MS);
      expect(runner.run).not.toHaveBeenCalled();
    }
  });

  it('links only roleplays the learner can still open', async () => {
    const view = await build({
      runs: [
        {
          mode: 'live',
          status: 'published',
          language: 'en',
          steps: [],
          cards: {
            practise_next: { skill: 'x', reason: 'y', scenario_id: 41 },
            work_on_this: [{ scenario_id: 41 }, { scenario_id: 7 }],
          },
        },
      ],
    }).learnerView('s', 7);
    expect(view.practice).toEqual([{ id: 41, title: 'Exam stress' }]);
  });
});
