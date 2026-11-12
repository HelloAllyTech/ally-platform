import { ForbiddenException } from '@nestjs/common';
import {
  DebriefAgentService,
  LIVE_START_DELAY_MS,
  learnerProgress,
} from '../service/debrief-agent.service';

function build(opts: {
  owner?: number;
  live?: boolean;
  runs?: Array<Record<string, unknown>>;
  endedMinutesAgo?: number;
  profile?: Record<string, unknown> | null;
  region?: 'india' | 'outside_india';
  stoppedMinutesAgo?: number;
  feedback?: Record<string, unknown> | null;
}) {
  const ended = new Date(Date.now() - (opts.endedMinutesAgo ?? 10) * 60_000);
  const dataSource = {
    query: jest.fn(async (sql: string) =>
      sql.includes(`->>'region'`)
        ? opts.region
          ? [{ scopeId: 't1', region: opts.region }]
          : []
        : sql.includes(`->>'live'`)
          ? []
          : sql.includes('guide_org_profiles')
            ? opts.profile
              ? [{ profile: opts.profile }]
              : []
            : [
                {
                  counselor_id: opts.owner ?? 7,
                  tenant_id: 't1',
                  status: 'ENDED',
                  ended_at: ended,
                  feedback: opts.feedback ?? null,
                },
              ],
    ),
  };
  const runs = { find: jest.fn(async () => opts.runs ?? []) };
  const overrides = {
    save: jest.fn(async () => undefined),
    get: jest.fn(async () =>
      opts.live === false
        ? opts.stoppedMinutesAgo !== undefined
          ? {
              values: {
                stoppedAt: Date.now() - opts.stoppedMinutesAgo * 60_000,
              },
            }
          : null
        : { values: { live: true } },
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
    { ready: jest.fn(async () => undefined) } as any,
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

  it('keeps a debrief already written after an emergency stop (FR-46)', async () => {
    const view = await build({
      live: false,
      runs: [
        {
          mode: 'live',
          status: 'published',
          cards: { opening: 'x' },
          language: 'en',
          steps: [],
        },
      ],
    }).learnerView('s', 7);
    expect(view).toMatchObject({ state: 'ready', cards: { opening: 'x' } });
  });

  it('says "not available" after an emergency stop, not today’s debrief (FR-46)', async () => {
    // A session that ended after the stop: nothing written by the agent.
    expect(
      await build({
        live: false,
        stoppedMinutesAgo: 30,
        endedMinutesAgo: 10,
        feedback: { supervisorNote: 'today’s note' },
      }).learnerView('s', 7),
    ).toEqual({ state: 'not_available', stopped: true });
    // A held run in the stopped organisation: no person-finished debrief either.
    expect(
      await build({
        live: false,
        stoppedMinutesAgo: 30,
        runs: [{ mode: 'live', status: 'needs_person', steps: [] }],
      }).learnerView('s', 7),
    ).toEqual({ state: 'not_available', stopped: true });
  });

  it('keeps today’s note written before an emergency stop (FR-46)', async () => {
    expect(
      await build({
        live: false,
        stoppedMinutesAgo: 10,
        endedMinutesAgo: 60,
        feedback: { supervisorNote: 'today’s note' },
      }).learnerView('s', 7),
    ).toEqual({ state: 'not_available' });
  });

  it('remembers when an organisation was stopped, and forgets it when switched back on', async () => {
    const svc = build({});
    const overrides = (svc as any).overrides;
    await svc.setLive('t1', false, 1);
    expect(overrides.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        change: { set: { stoppedAt: expect.any(Number) }, clear: ['live'] },
      }),
    );
    await svc.setLive('t1', true, 1);
    expect(overrides.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        change: { set: { live: true }, clear: ['stoppedAt'] },
      }),
    );
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

  it('outside India, gives no default line and refuses to switch on without one (FR-25)', async () => {
    const run = {
      mode: 'live',
      status: 'published',
      cards: {},
      language: 'en',
      steps: [],
    };
    const away = build({ runs: [run], region: 'outside_india' });
    expect((await away.learnerView('s', 7)).supportLines).toEqual([]);
    await expect(away.setLive('t1', true, 1)).rejects.toThrow(
      'needs its own support line',
    );
    await expect(away.setLive('t1', false, 1)).resolves.toBeUndefined();
    const withLines = build({
      runs: [run],
      region: 'outside_india',
      profile: { supportLines: { en: [{ name: 'Local line', phone: '1' }] } },
    });
    await expect(withLines.setLive('t1', true, 1)).resolves.toBeUndefined();
    await expect(
      build({ runs: [run] }).setLive('t1', true, 1),
    ).resolves.toBeUndefined();
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

  it('a run a person must finish reads as on its way with a risk cue, else taking longer', async () => {
    expect(
      (
        await build({
          runs: [
            {
              mode: 'live',
              status: 'needs_person',
              hasRiskCue: true,
              steps: [],
            },
          ],
        }).learnerView('s', 7)
      ).state,
    ).toBe('on_its_way');
    for (const status of ['needs_person', 'failed']) {
      expect(
        (
          await build({
            runs: [{ mode: 'live', status, hasRiskCue: false, steps: [] }],
          }).learnerView('s', 7)
        ).state,
      ).toBe('taking_longer');
    }
  });
});

describe('learnerProgress (FR-27)', () => {
  it('names the topic, the round, and the careful path', () => {
    expect(
      learnerProgress(
        { step: 'guidance_lookup', topic: 'Exploring risk' },
        false,
      ),
    ).toEqual({ key: 'guidance', topic: 'Exploring risk' });
    expect(learnerProgress({ step: 'reviser', round: 2 }, true)).toEqual({
      key: 'revising',
      round: 2,
    });
    expect(learnerProgress({ step: 'writer' }, true)).toEqual({ key: 'care' });
    expect(learnerProgress({ step: 'writer' }, false)).toEqual({
      key: 'writing',
    });
    expect(learnerProgress({ step: 'evaluator' }, false)).toEqual({
      key: 'reviewing',
    });
    expect(learnerProgress(undefined, false)).toBeNull();
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
    const releases = { syncSeed: jest.fn(), getGa: jest.fn(async () => null) };
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
      { available: jest.fn(async () => []) } as any,
      { ready: jest.fn(async () => undefined) } as any,
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

  it('a short session reads as the opening and one card: no Practise next, no skill words (plan §8.2)', async () => {
    const view = await build({
      runs: [
        {
          mode: 'live',
          status: 'published',
          recipeKey: 'short',
          language: 'en',
          steps: [],
          cards: {
            opening: 'o',
            work_on_this: [{ lead: 'w', scenario_id: 7 }],
            practise_next: { skill: 'x', reason: 'y', scenario_id: 41 },
            skill_words: [{ skill: 'x', word: 'strength' }],
          },
        },
      ],
    }).learnerView('s', 7);
    expect(view.cards).toMatchObject({
      opening: 'o',
      practise_next: null,
      skill_words: [],
    });
    expect(view.cards?.work_on_this).toHaveLength(1);
    expect(view.practice).toEqual([]);
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

describe('DebriefAgentService.sweepStuckRuns', () => {
  it('sends a stuck live run to a person and fails a stuck shadow run', async () => {
    const query = jest.fn(async () => [
      [
        { id: 'a', mode: 'live' },
        { id: 'b', mode: 'shadow' },
      ],
      2,
    ]);
    const svc = new DebriefAgentService(
      { query } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { ready: jest.fn(async () => undefined) } as any,
    );
    expect(await svc.sweepStuckRuns()).toBe(2);
    const [sql, params] = query.mock.calls[0] as unknown as [string, string[]];
    expect(sql).toContain("CASE WHEN mode = 'live' THEN $1 ELSE $2 END");
    expect(sql).toContain("interval '10 minutes'");
    expect(params).toEqual(['needs_person', 'failed', 'running']);
  });
});
