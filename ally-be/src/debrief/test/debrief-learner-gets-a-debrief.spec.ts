import {
  DebriefAgentService,
  istDay,
  retryPending,
  withPractiseNextFallback,
  withoutPractice,
} from '../service/debrief-agent.service';
import { keepOfferedPractice } from '../util/debrief-cards.util';
import { DebriefPracticeService } from '../service/debrief-practice.service';
import { DebriefRunMode, DebriefRunStatus } from '../enum/debrief-run.enum';
import {
  modelTier,
  substituteModel,
} from '../util/debrief-provider-allowlist.util';
import { DEBRIEF_MODELS } from '../constants/debrief-release.constants';

/**
 * Gopi, 2026-11-16: "as much as possible the learner should get the
 * debrief; in the worst case fall back to the old debrief". What happens
 * after a run returns: a retry, the owner told about the cap.
 */
function agent(opts: {
  /** What the retry claim answers (rows claimed). */
  claim?: boolean;
  retried?: Record<string, unknown>;
  providers?: Record<string, boolean>;
  noticeTaken?: boolean;
}) {
  const sql: string[] = [];
  const dataSource = {
    query: jest.fn(async (q: string) => {
      sql.push(q);
      if (q.includes("'{retries}'")) return opts.claim ? [{ id: 'r1' }] : [];
      if (q.includes('overCapNotice'))
        return opts.noticeTaken ? [] : [{ id: 'r1' }];
      return [];
    }),
  };
  const runs = { findOne: jest.fn(async () => ({ id: 'r1' })) };
  const runner = {
    retry: jest.fn(async () => ({
      id: 'r1',
      mode: DebriefRunMode.LIVE,
      scenarioSessionId: 's1',
      tenantId: 't1',
      workspace: { retries: 1 },
      ...(opts.retried ?? {}),
    })),
  };
  const judge = { judge: jest.fn(async () => undefined) };
  const overrides = {
    get: jest.fn(async () => ({
      values: { live: true, ...(opts.providers ?? {}) },
    })),
  };
  const notifier = {
    ready: jest.fn(async () => undefined),
    owner: jest.fn(async () => 1),
  };
  const slack = {
    post: jest.fn(async () => true),
    missedRiskCue: jest.fn(async () => false),
  };
  const svc = new DebriefAgentService(
    dataSource as any,
    runs as any,
    runner as any,
    judge as any,
    {} as any,
    overrides as any,
    { debriefAgentMode: 'shadow' } as any,
    {} as any,
    notifier as any,
    undefined,
    undefined,
    undefined,
    undefined,
    slack as any,
  );
  // The old note is retired: no sweep marks a run or asks for it.
  const askedForToday = () =>
    sql.filter((q) => q.includes('fallbackToToday')).length;
  return { svc, runner, notifier, slack, askedForToday, sql };
}

const noDraft = (o: Record<string, unknown> = {}) =>
  ({
    id: 'r1',
    mode: DebriefRunMode.LIVE,
    scenarioSessionId: 's1',
    tenantId: 't1',
    status: DebriefRunStatus.NEEDS_PERSON,
    skipReason: 'safety_reader_failed',
    cards: null,
    workspace: {},
    ...o,
  }) as any;

describe('after a live run returns', () => {
  it('runs one with no draft again once, and publishes what the retry writes', async () => {
    const { svc, runner, notifier, askedForToday } = agent({
      claim: true,
      retried: {
        status: DebriefRunStatus.PUBLISHED,
        cards: { opening: 'x' },
        finishedAt: new Date(),
      },
    });
    const out = await svc.afterRun(noDraft());
    expect(runner.retry).toHaveBeenCalledTimes(1);
    expect(out.status).toBe(DebriefRunStatus.PUBLISHED);
    expect(notifier.ready).toHaveBeenCalled();
    expect(askedForToday()).toBe(0);
  });

  it('leaves the learner at "not available" when the retry has no draft either: nothing is regenerated', async () => {
    const { svc, runner, askedForToday } = agent({
      claim: true,
      retried: {
        status: DebriefRunStatus.NEEDS_PERSON,
        skipReason: 'safety_reader_failed',
        cards: null,
      },
    });
    const out = await svc.afterRun(noDraft());
    // Retried once only: the retry's own retry count is spent.
    expect(runner.retry).toHaveBeenCalledTimes(1);
    expect(out.workspace.fallbackToToday).toBeUndefined();
    expect(askedForToday()).toBe(0);
    expect((svc as any).fallBackToToday).toBeUndefined();
    expect((svc as any).fallBackSweep).toBeUndefined();
  });

  it('a run whose provider has no model is not retried and nothing is regenerated', async () => {
    const { svc, runner, askedForToday } = agent({});
    await svc.afterRun(
      noDraft({
        status: DebriefRunStatus.SKIPPED,
        skipReason: 'provider_not_allowed',
      }),
    );
    expect(runner.retry).not.toHaveBeenCalled();
    expect(askedForToday()).toBe(0);
  });

  it('a too-short session is not a missing debrief', async () => {
    const { svc, askedForToday } = agent({});
    await svc.afterRun(
      noDraft({ status: DebriefRunStatus.SKIPPED, skipReason: 'too_short' }),
    );
    expect(askedForToday()).toBe(0);
  });

  it('knows which runs still have a retry due', () => {
    expect(retryPending(noDraft())).toBe(true);
    expect(retryPending(noDraft({ status: DebriefRunStatus.FAILED }))).toBe(
      true,
    );
    expect(retryPending(noDraft({ workspace: { retries: 1 } }))).toBe(false);
    expect(retryPending(noDraft({ skipReason: 'checks_failed' }))).toBe(false);
    expect(retryPending(noDraft({ cards: { opening: 'x' } }))).toBe(false);
    expect(retryPending(noDraft({ mode: DebriefRunMode.SHADOW }))).toBe(false);
  });
});

describe('a debrief past the month’s budget', () => {
  const overCap = () =>
    noDraft({
      status: DebriefRunStatus.PUBLISHED,
      cards: { opening: 'x' },
      workspace: {
        overCap: true,
        overCapSpend: { spentUsd: 52.3, capUsd: 50 },
      },
    });

  it('tells the owner in the app and on Slack, with the amount', async () => {
    const { svc, notifier, slack, sql } = agent({});
    expect(await svc.notifyOverCap(overCap())).toBe(true);
    expect(notifier.owner).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringMatching(/\$50\.00.*\$52\.30/),
      }),
    );
    expect(slack.post).toHaveBeenCalledWith(expect.stringMatching(/\$52\.30/));
    expect(sql.find((q) => q.includes('overCapNotice'))).toBeDefined();
  });

  it('only once a day', async () => {
    const { svc, notifier } = agent({ noticeTaken: true });
    expect(await svc.notifyOverCap(overCap())).toBe(false);
    expect(notifier.owner).not.toHaveBeenCalled();
  });

  it('says nothing for a run within budget', async () => {
    const { svc, notifier } = agent({});
    expect(
      await svc.notifyOverCap(noDraft({ workspace: { overCap: false } })),
    ).toBe(false);
    expect(notifier.owner).not.toHaveBeenCalled();
  });

  it('counts days in IST', () => {
    // 20:00 UTC on 16 Nov is 01:30 on 17 Nov in India.
    expect(istDay(Date.UTC(2026, 10, 16, 20, 0))).toBe('2026-11-17');
  });
});

describe('Practise this again inside a course (clinical review 2026-11-16)', () => {
  const practice = (rows: unknown[], ownTip: string | null = 'tip-1') => {
    const dataSource = {
      query: jest.fn(async (q: string) => {
        if (q.includes('track_item_id')) return rows;
        if (q.includes('"trackItemProgressId" AS tip'))
          return [{ tip: ownTip }];
        if (q.includes('competencies')) return [];
        return [];
      }),
    };
    const scenarios = {
      getScenariosV2: jest.fn(async () => ({
        data: [
          { id: 99, title: 'Library roleplay' },
          { id: 4, title: 'Another roleplay' },
        ],
      })),
    };
    return {
      svc: new DebriefPracticeService(dataSource as any, scenarios as any),
      scenarios,
    };
  };
  const thisOne = [
    { id: 3, title: 'This one', course: 'Basics', track_item_id: 'i3' },
  ];

  it('offers nothing inside a course: the course decides what comes next', async () => {
    const { svc, scenarios } = practice(thisOne);
    expect(await svc.optionsFor(7, 't1', 's1')).toEqual([]);
    expect(scenarios.getScenariosV2).not.toHaveBeenCalled();
  });

  it('offers nothing when the course cannot be read', async () => {
    const { svc, scenarios } = practice([]);
    expect(await svc.optionsFor(7, 't1', 's1')).toEqual([]);
    expect(await svc.available(7, 't1', [99], 's1')).toEqual([]);
    expect(scenarios.getScenariosV2).not.toHaveBeenCalled();
  });

  it("offers the learner's own list outside a course", async () => {
    const { svc } = practice([], null);
    expect((await svc.optionsFor(7, 't1', 's1')).map((o) => o.id)).toEqual([
      99, 4,
    ]);
  });

  it('shows no practise button inside a course, not even for this same roleplay', async () => {
    const { svc } = practice(thisOne);
    expect(await svc.available(7, 't1', [3, 4, 99], 's1')).toEqual([]);
  });

  it('strips the practise card and every roleplay link from a course debrief', () => {
    const cards = {
      opening: 'Hi',
      practise_next: {
        skill: 'Empathy',
        reason: 'r',
        scenario_id: 3,
        try_next: ['a'],
      },
      work_on_this: [{ point: 'p', scenario_id: 3 }],
    };
    const out = withoutPractice(cards) as any;
    expect(out.practise_next).toBeUndefined();
    expect(out.work_on_this).toEqual([{ point: 'p', scenario_id: null }]);
    expect(out.opening).toBe('Hi');
    expect(withoutPractice(null)).toBeNull();
  });
});

describe('a step with no model on an allowed provider (FR-57)', () => {
  it('gets a priced model on an allowed provider, same tier first', () => {
    expect(modelTier('gemini-2.5-flash')).toBe('fast');
    expect(modelTier('gemini-2.5-pro')).toBe('strong');
    expect(
      substituteModel(
        'gemini-2.5-flash',
        ['gpt-4.1', 'gpt-4.1-mini', 'claude-sonnet-4-5', 'gemini-2.5-flash'],
        ['openai'],
      ),
    ).toBe('gpt-4.1-mini');
    expect(
      substituteModel(
        'gemini-2.5-pro',
        ['gpt-4.1', 'gpt-4.1-mini'],
        ['openai'],
      ),
    ).toBe('gpt-4.1');
  });

  it('never a provider the organisation does not allow, an unpriced model or the judge’s', () => {
    expect(
      substituteModel('gemini-2.5-flash', ['claude-sonnet-4-5'], ['openai']),
    ).toBeNull();
    expect(
      substituteModel('gemini-2.5-flash', ['gpt-unknown-9'], ['openai']),
    ).toBeNull();
    expect(
      substituteModel('gemini-2.5-flash', [DEBRIEF_MODELS.judge], ['gemini']),
    ).toBeNull();
  });
});

describe('"Practise this next" never loses its button', () => {
  const cards = (scenario_id: number | null) =>
    ({
      opening: 'x',
      what_worked: [],
      work_on_this: [{ skill: 's', scenario_id: 99 }],
      practise_next: { skill: 'Boundaries', reason: 'r', scenario_id },
      skill_words: [],
      reflective_question: 'q',
    }) as any;

  it('maps a missing or unoffered id to the fallback (this roleplay) when it is offered', () => {
    const offered = new Set([3, 7]);
    expect(
      keepOfferedPractice(cards(null), offered, 3).practise_next?.scenario_id,
    ).toBe(3);
    expect(
      keepOfferedPractice(cards(42), offered, 3).practise_next?.scenario_id,
    ).toBe(3);
    // A chosen, offered id stays; Work-on-this links get no fallback.
    const kept = keepOfferedPractice(cards(7), offered, 3);
    expect(kept.practise_next?.scenario_id).toBe(7);
    expect(kept.work_on_this[0].scenario_id).toBeNull();
    // A fallback that was not offered is never used.
    expect(
      keepOfferedPractice(cards(null), offered, 5).practise_next?.scenario_id,
    ).toBeNull();
  });

  it('the learner view points an unopenable link at this same roleplay', () => {
    const mapped = withPractiseNextFallback(cards(42), [{ id: 3 }], 3) as any;
    expect(mapped.practise_next.scenario_id).toBe(3);
    // Nothing the learner can open: left as is (the apps offer the list).
    expect(
      (withPractiseNextFallback(cards(42), [], 3) as any).practise_next
        .scenario_id,
    ).toBe(42);
    // An openable link is kept.
    expect(
      (withPractiseNextFallback(cards(3), [{ id: 3 }, { id: 4 }], 4) as any)
        .practise_next.scenario_id,
    ).toBe(3);
  });

  it('the learner view serves the mapped link with its roleplay', async () => {
    const dataSource = {
      query: jest.fn(async (q: string) =>
        q.includes('FROM scenario_sessions s WHERE s.id')
          ? [
              {
                counselor_id: 7,
                tenant_id: 't1',
                status: 'ENDED',
                ended_at: new Date(),
                feedback: null,
                learner_turns: 5,
                debrief_tab_off: false,
                scenario_id: 3,
              },
            ]
          : [],
      ),
    };
    const runs = {
      find: jest.fn(async () => [
        {
          id: 'r1',
          mode: 'live',
          status: 'published',
          cards: cards(null),
          language: 'en',
          steps: [],
          workspace: {},
        },
      ]),
    };
    const practice = {
      inCourse: jest.fn(async () => false),
      available: jest.fn(async (_u: number, _t: string, ids: number[]) =>
        ids.includes(3)
          ? [{ id: 3, title: 'This one', trackItemId: 'i3' }]
          : [],
      ),
    };
    const svc = new DebriefAgentService(
      dataSource as any,
      runs as any,
      {} as any,
      {} as any,
      {} as any,
      { get: jest.fn(async () => ({ values: { live: true } })) } as any,
      { debriefAgentMode: 'shadow' } as any,
      practice as any,
      {} as any,
    );
    const view = await svc.learnerView('s1', 7);
    expect((view.cards as any).practise_next.scenario_id).toBe(3);
    expect(view.practice).toEqual([
      { id: 3, title: 'This one', trackItemId: 'i3' },
    ]);
  });
});
