import { ForbiddenException } from '@nestjs/common';
import {
  DebriefAgentService,
  LIVE_START_DELAY_MS,
  learnerProgress,
} from '../service/debrief-agent.service';
import { DEBRIEF_FALLBACK_TO_TODAY_EVENT } from '../util/debrief-live.util';

function build(opts: {
  owner?: number;
  live?: boolean;
  runs?: Array<Record<string, unknown>>;
  endedMinutesAgo?: number;
  profile?: Record<string, unknown> | null;
  region?: 'india' | 'outside_india';
  stoppedMinutesAgo?: number;
  feedback?: Record<string, unknown> | null;
  learnerTurns?: number;
  debriefTabOff?: boolean;
  mode?: 'off' | 'shadow';
  /** The organisation's stored provider switches. */
  providers?: Record<string, boolean>;
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
                  learner_turns: opts.learnerTurns,
                  debrief_tab_off: opts.debriefTabOff ?? false,
                },
              ],
    ),
  };
  const events = { emit: jest.fn() };
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
        : { values: { live: true, ...(opts.providers ?? {}) } },
    ),
  };
  return new DebriefAgentService(
    dataSource as any,
    runs as any,
    {} as any,
    {} as any,
    {} as any,
    overrides as any,
    { debriefAgentMode: opts.mode ?? 'shadow' } as any,
    {
      inCourse: jest.fn(async () => false),
      available: jest.fn(async (_u: number, _t: string, ids: number[]) =>
        ids
          .filter((id) => id === 41)
          .map((id) => ({ id, title: 'Exam stress' })),
      ),
    } as any,
    { ready: jest.fn(async () => undefined) } as any,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    events as any,
  );
}

/** Whether the view asked the session service for today's debrief. */
const askedForToday = (svc: DebriefAgentService) =>
  ((svc as any).events.emit as jest.Mock).mock.calls.some(
    ([name]) => name === DEBRIEF_FALLBACK_TO_TODAY_EVENT,
  );

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
      riskCue: false,
      supportLines: expect.any(Array),
      practice: [],
      askAlly: { open: true },
    });
  });

  it('inside a course, serves no practise card and no roleplay link, even on a debrief written before the rule', async () => {
    const svc = build({
      runs: [
        {
          mode: 'live',
          status: 'published',
          cards: {
            opening: 'x',
            practise_next: {
              skill: 'Empathy',
              reason: 'r',
              scenario_id: 41,
              try_next: ['a'],
            },
            work_on_this: [{ point: 'p', scenario_id: 41 }],
          },
          language: 'en',
          steps: [],
        },
      ],
    });
    ((svc as any).practice.inCourse as jest.Mock).mockResolvedValue(true);
    const view = (await svc.learnerView('s', 7)) as any;
    expect(view.cards.practise_next).toBeUndefined();
    expect(view.cards.work_on_this).toEqual([
      { point: 'p', scenario_id: null },
    ]);
    expect(view.practice).toEqual([]);
  });

  it('keeps Ask Ally closed after its limit, until the month turns for the month limit', async () => {
    const view = (askAllyLimit: Record<string, unknown>) =>
      build({
        runs: [
          {
            mode: 'live',
            status: 'published',
            cards: { opening: 'x' },
            language: 'en',
            steps: [],
            workspace: { askAllyLimit },
          },
        ],
      }).learnerView('s', 7);
    expect(
      (await view({ reason: 'session', at: new Date().toISOString() })).askAlly,
    ).toEqual({ open: false, reason: 'session' });
    expect(
      (await view({ reason: 'month', at: new Date().toISOString() })).askAlly,
    ).toEqual({ open: false, reason: 'month' });
    expect(
      (
        await view({
          reason: 'month',
          at: new Date(Date.now() - 40 * 86_400_000).toISOString(),
        })
      ).askAlly,
    ).toEqual({ open: true });
  });

  it('says too short at once when the learner said nothing', async () => {
    expect(await build({ learnerTurns: 0 }).learnerView('s', 7)).toEqual({
      state: 'too_short',
    });
  });

  it('gives today’s debrief when the agent is off or the roleplay’s Debrief tab is off', async () => {
    for (const o of [{ mode: 'off' as const }, { debriefTabOff: true }]) {
      const svc = build(o);
      expect(await svc.learnerView('s', 7)).toEqual({
        state: 'not_available',
      });
      expect(askedForToday(svc)).toBe(true);
    }
  });

  it('stops "working" 30 minutes after the session ended with no run', async () => {
    expect(
      (await build({ endedMinutesAgo: 20 }).learnerView('s', 7)).state,
    ).toBe('working');
    const late = build({ endedMinutesAgo: 31 });
    expect(await late.learnerView('s', 7)).toEqual({ state: 'not_available' });
    expect(askedForToday(late)).toBe(true);
  });

  it('does not ask for today’s debrief again when it is already written', async () => {
    const svc = build({
      endedMinutesAgo: 31,
      feedback: { supervisorNote: 'today’s note' },
    });
    expect((await svc.learnerView('s', 7)).state).toBe('not_available');
    expect(askedForToday(svc)).toBe(false);
  });

  it('says "not available" instead of today’s debrief when its provider is not allowed (FR-57)', async () => {
    const svc = build({
      endedMinutesAgo: 31,
      providers: { 'providerAllowed.openai': false },
    });
    expect(await svc.learnerView('s', 7)).toEqual({
      state: 'not_available',
      stopped: true,
      reason: 'provider_not_allowed',
    });
    expect(askedForToday(svc)).toBe(false);
    // Another provider switched off: today's debrief is still allowed.
    const ok = build({
      endedMinutesAgo: 31,
      providers: { 'providerAllowed.anthropic': false },
    });
    expect(await ok.learnerView('s', 7)).toEqual({ state: 'not_available' });
    expect(askedForToday(ok)).toBe(true);
  });

  it('says when the safety reading found a risk cue, so the support lines show without an important moment', async () => {
    const view = await build({
      runs: [
        {
          mode: 'live',
          status: 'published',
          cards: { opening: 'x' },
          language: 'en',
          steps: [],
          hasRiskCue: true,
        },
      ],
    }).learnerView('s', 7);
    expect(view).toMatchObject({ state: 'ready', riskCue: true });
    expect((view as any).supportLines.length).toBeGreaterThan(0);
  });

  it('does not bring the support lines for a character’s risk cue when the roleplay’s option says not to, but still for the learner’s own distress', async () => {
    const run = (extra: Record<string, unknown>) => ({
      mode: 'live',
      status: 'published',
      cards: { opening: 'x' },
      language: 'en',
      steps: [],
      hasRiskCue: true,
      workspace: {
        riskCueOption: { key: 'part_of_practice', supportLinesOnCue: false },
      },
      ...extra,
    });
    const quiet = await build({ runs: [run({})] }).learnerView('s', 7);
    expect(quiet).toMatchObject({
      state: 'ready',
      riskCue: false,
      distress: false,
    });
    const distressed = await build({
      runs: [run({ learnerDistress: true })],
    }).learnerView('s', 7);
    expect(distressed).toMatchObject({ riskCue: false, distress: true });
    // A run with no record of an option (every run before them) behaves as today.
    const legacy = await build({
      runs: [run({ workspace: {} })],
    }).learnerView('s', 7);
    expect(legacy).toMatchObject({ riskCue: true });
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

  it('a held draft reads as on its way with a risk cue, else taking longer', async () => {
    for (const [hasRiskCue, state] of [
      [true, 'on_its_way'],
      [false, 'taking_longer'],
    ] as const) {
      expect(
        (
          await build({
            runs: [
              {
                mode: 'live',
                status: 'needs_person',
                hasRiskCue,
                cards: { opening: 'x' },
                steps: [],
              },
            ],
          }).learnerView('s', 7)
        ).state,
      ).toBe(state);
    }
  });

  it('a run with no draft is working while its retry is due, then today’s debrief', async () => {
    const run = (o: Record<string, unknown>) => ({
      mode: 'live',
      steps: [],
      cards: null,
      workspace: {},
      ...o,
    });
    expect(
      (
        await build({
          runs: [run({ status: 'needs_person', skipReason: 'writer_failed' })],
        }).learnerView('s', 7)
      ).state,
    ).toBe('working');
    expect(
      (await build({ runs: [run({ status: 'failed' })] }).learnerView('s', 7))
        .state,
    ).toBe('working');
    for (const r of [
      run({
        status: 'needs_person',
        skipReason: 'safety_reader_failed',
        hasRiskCue: true,
        workspace: { retries: 1 },
      }),
      run({ status: 'failed', workspace: { retries: 1 } }),
      run({ status: 'skipped', skipReason: 'provider_not_allowed' }),
    ]) {
      const svc = build({ runs: [r] });
      expect(await svc.learnerView('s', 7)).toEqual({
        state: 'not_available',
      });
      expect(askedForToday(svc)).toBe(true);
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
      {
        inCourse: jest.fn(async () => false),
        available: jest.fn(async () => []),
      } as any,
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

describe('DebriefAgentService.showHeldDrafts', () => {
  it('shows a held live draft below the bar, writes it and tells the learner', async () => {
    const run = { id: 'a', mode: 'live', status: 'below_bar', cards: {} };
    const query = jest.fn(async () => [[{ id: 'a' }], 1]);
    const findOne = jest.fn(async () => run);
    const applyToSession = jest.fn(async () => true);
    const ready = jest.fn(async () => undefined);
    const svc = new DebriefAgentService(
      { query } as any,
      { findOne } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { ready } as any,
      { applyToSession } as any,
    );
    expect(await svc.showHeldDrafts()).toBe(1);
    const [sql, params] = query.mock.calls[0] as unknown as [string, string[]];
    expect(sql).toContain('cards IS NOT NULL');
    expect(sql).toContain("NOT (coalesce(workspace, '{}'::jsonb) ? 'review')");
    expect(params).toEqual(['below_bar', 'needs_person']);
    expect(applyToSession).toHaveBeenCalledWith(run);
    expect(ready).toHaveBeenCalledWith(run);
  });
});
