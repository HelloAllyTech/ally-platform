import { ConflictException } from '@nestjs/common';
import {
  ManualRunLedger,
  estimateCallMaxUsd,
} from '../service/manual-run-ledger';
import {
  istDate,
  istWeekStart,
  ManualWeeklyAgentService,
  orderWorkQueue,
  templatedSummary,
} from '../service/manual-weekly-agent.service';
import { ManualSchedulerRegistrationService } from '../service/manual-scheduler-registration.service';
import type { ManualLoopRequest } from '../service/manual-agent-core';
import { MANUAL_WEEKLY_LIMITS } from '../constants/manual-agent.constants';

const NOW = new Date('2026-11-23T02:00:00Z'); // a Monday, 07:30 IST
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const page = (slug: string, over: Record<string, unknown> = {}) =>
  ({
    slug,
    title: slug,
    kind: 'page',
    body: 'b',
    surfaces: [],
    verifiedAt: null,
    updatedAt: daysAgo(10),
    deletedAt: null,
    ...over,
  }) as any;

describe('ManualRunLedger', () => {
  it('reserves until the cap, settles to actual, and refuses what it cannot cover', () => {
    const ledger = new ManualRunLedger(1);
    const a = ledger.reserve(0.6)!;
    expect(a).toBeTruthy();
    expect(ledger.reserve(0.5)).toBeNull();
    ledger.settle(a, 0.2);
    expect(ledger.spent).toBe(0.2);
    expect(ledger.remainingUsd).toBe(0.8);
    const b = ledger.reserve(0.5)!;
    ledger.release(b);
    expect(ledger.reserved).toBe(0);
    expect(ledger.remainingUsd).toBe(0.8);
  });

  it('reserves more, never less, for a model the pricing table does not know', () => {
    expect(estimateCallMaxUsd('no-such-model', 3000, 1000)).toBeGreaterThan(0);
  });
});

describe('orderWorkQueue', () => {
  it('orders proposals oldest first, then never-verified, then stale, then code-changed pages', () => {
    const proposals = [
      { id: 'p2', pageSlug: 'covered', createdAt: daysAgo(1) },
      { id: 'p1', pageSlug: null, createdAt: daysAgo(5) },
    ] as any[];
    const pages = [
      page('fresh', { verifiedAt: daysAgo(1), updatedAt: daysAgo(30) }),
      page('stale-new', { verifiedAt: daysAgo(40) }),
      page('stale-old', { verifiedAt: daysAgo(90) }),
      page('never', {}),
      page('covered', {}),
      page('code-moved', {
        verifiedAt: daysAgo(3),
        updatedAt: daysAgo(20),
        surfaces: ['admin'],
      }),
      page('empty-section', { kind: 'section', body: '' }),
    ];
    const { items, more } = orderWorkQueue({
      proposals,
      pages,
      codeChangedAt: new Map([
        ['ally-web/apps/ally-admin-dashboard', daysAgo(1)],
      ]),
      now: NOW,
      limit: 25,
    });
    expect(
      items.map((i) =>
        i.kind === 'proposal' ? i.proposal.id : `${i.page.slug}:${i.why}`,
      ),
    ).toEqual([
      'p1',
      'p2',
      'never:never_verified',
      'stale-old:stale',
      'stale-new:stale',
      'code-moved:code_changed',
    ]);
    expect(more).toBe(false);
  });

  it('puts pages tried in the last 14 days behind untried ones, and retries them after', () => {
    const pages = [
      page('stuck-new', { lastAttemptAt: daysAgo(2) }),
      page('untried-b', { updatedAt: daysAgo(5) }),
      page('retry-old', { lastAttemptAt: daysAgo(20), updatedAt: daysAgo(30) }),
      page('untried-a', { updatedAt: daysAgo(9) }),
    ];
    const { items } = orderWorkQueue({
      proposals: [],
      pages,
      codeChangedAt: new Map(),
      now: NOW,
      limit: 25,
    });
    expect(items.map((i) => (i.kind === 'page' ? i.page.slug : '?'))).toEqual([
      // untried first (a tried-20-days-ago page is due again, so it is "untried" and oldest-updated first)
      'retry-old',
      'untried-a',
      'untried-b',
      // then the stuck page, never dropped
      'stuck-new',
    ]);
  });

  it('caps the queue and says more is waiting', () => {
    const pages = Array.from({ length: 30 }, (_, i) => page(`p${i}`));
    const { items, more } = orderWorkQueue({
      proposals: [],
      pages,
      codeChangedAt: new Map(),
      now: NOW,
      limit: 25,
    });
    expect(items).toHaveLength(25);
    expect(more).toBe(true);
  });
});

describe('IST dates', () => {
  it('finds the IST date and its week’s Monday', () => {
    expect(istDate(new Date('2026-11-22T20:00:00Z'))).toBe('2026-11-23'); // 01:30 IST Monday
    expect(istWeekStart(new Date('2026-11-22T20:00:00Z'))).toBe('2026-11-23');
    expect(istWeekStart(new Date('2026-11-26T10:00:00Z'))).toBe('2026-11-23');
    expect(istWeekStart(new Date('2026-11-22T10:00:00Z'))).toBe('2026-11-16'); // Sunday
  });
});

function setup(
  opts: { enabled?: boolean; exhausted?: boolean; begin?: boolean } = {},
) {
  const settings = {
    get: jest.fn().mockResolvedValue({
      enabled: opts.enabled ?? true,
      monthlyBudgetUsd: 100,
    }),
    recordLastRun: jest.fn().mockResolvedValue(undefined),
  };
  const budget = {
    snapshot: jest.fn().mockResolvedValue({
      monthlyBudgetUsd: 100,
      spentUsd: opts.exhausted ? 100 : 0,
      reservedUsd: 0,
      exhausted: !!opts.exhausted,
    }),
    runCapUsd: jest.fn().mockReturnValue(opts.exhausted ? 0 : 25),
  };
  const runRow = { id: 'run-1' };
  const runs = {
    begin: jest.fn().mockResolvedValue(opts.begin === false ? null : runRow),
    recordSkipped: jest.fn(
      async (_t: string, _b: unknown, stopReason: string) => ({
        id: `skip-${stopReason}`,
      }),
    ),
    progress: jest.fn().mockResolvedValue(undefined),
    finish: jest.fn().mockResolvedValue(undefined),
    claimWeek: jest.fn().mockResolvedValue(true),
  };
  const proposals = {
    listOpen: jest.fn().mockResolvedValue([
      {
        id: 'prop-1',
        kind: 'edit',
        pageSlug: 'a',
        summary: 'Rename',
        source: 'coding_agent',
        createdAt: daysAgo(2),
      },
    ]),
  };
  const pages = {
    list: jest.fn().mockResolvedValue([page('a'), page('b')]),
    markAttempted: jest.fn().mockResolvedValue(undefined),
  };
  const tools = {
    getToolDefinitions: jest.fn().mockReturnValue([]),
    codeSearchAvailable: jest.fn().mockReturnValue(true),
    describe: jest.fn(),
    execute: jest.fn(),
  };
  const requests: ManualLoopRequest[] = [];
  const core = {
    resolveTarget: jest
      .fn()
      .mockResolvedValue({ provider: 'openai', model: 'gpt-5-mini' }),
    run: jest.fn(async function* (request: ManualLoopRequest) {
      requests.push(request);
      return {
        status: 'done',
        text: 'Summary paragraph.',
        iterations: 1,
        costUsd: 0.01,
      };
    }),
  };
  const freshness = {
    masterShortSha: jest.fn().mockResolvedValue('abc123def456'),
    lastChangedAt: jest.fn().mockResolvedValue(null),
  };
  const service = new ManualWeeklyAgentService(
    settings as never,
    budget as never,
    runs as never,
    proposals as never,
    pages as never,
    tools as never,
    core as never,
    freshness as never,
  );
  return {
    service,
    settings,
    budget,
    runs,
    core,
    requests,
    tools,
    pages,
    proposalsMock: proposals,
  };
}

describe('ManualWeeklyAgentService', () => {
  it('records a skipped run when a scheduled run finds the agent switched off', async () => {
    const { service, runs, core } = setup({ enabled: false });
    await expect(
      service.run({ trigger: 'scheduled', triggeredBy: null }),
    ).resolves.toMatchObject({
      status: 'skipped',
      stopReason: 'disabled',
    });
    expect(runs.recordSkipped).toHaveBeenCalledWith(
      'scheduled',
      null,
      'disabled',
      expect.any(String),
    );
    expect(core.run).not.toHaveBeenCalled();
  });

  it('refuses Run now with a 409 when switched off, out of budget, or already running', async () => {
    await expect(setup({ enabled: false }).service.start(7)).rejects.toThrow(
      /switched off/,
    );
    const exhausted = setup({ exhausted: true });
    await expect(exhausted.service.start(7)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(exhausted.runs.recordSkipped).toHaveBeenCalledWith(
      'manual',
      7,
      'budget_exhausted',
      expect.any(String),
    );
    await expect(setup({ begin: false }).service.start(7)).rejects.toThrow(
      /already in progress/,
    );
  });

  it('skips with budget_exhausted before any model call', async () => {
    const { service, core, runs } = setup({ exhausted: true });
    const result = await service.run({
      trigger: 'scheduled',
      triggeredBy: null,
    });
    expect(result).toMatchObject({
      status: 'skipped',
      stopReason: 'budget_exhausted',
    });
    expect(runs.begin).not.toHaveBeenCalled();
    expect(core.run).not.toHaveBeenCalled();
  });

  it('works the queue under one ledger, then finishes the run and the settings row', async () => {
    const { service, runs, settings, requests } = setup();
    const result = await service.run({
      trigger: 'scheduled',
      triggeredBy: null,
    });
    expect(result).toEqual({
      runId: 'run-1',
      status: 'done',
      stopReason: null,
    });
    expect(runs.begin).toHaveBeenCalledWith('scheduled', null, 25);
    // page a, page b (an open proposal no longer takes a page out of the queue), then the summary call.
    expect(requests).toHaveLength(3);
    expect(requests[0].messages[0].content).toContain('slug a');
    expect(requests[1].messages[0].content).toContain('slug b');
    expect(requests.every((r) => r.gate === requests[0].gate)).toBe(true);
    expect(requests[0].maxIterations).toBe(
      MANUAL_WEEKLY_LIMITS.MAX_ITERATIONS_PER_PAGE,
    );
    // The first production run verified nothing at 8 steps a page; keep real headroom.
    expect(MANUAL_WEEKLY_LIMITS.MAX_ITERATIONS_PER_PAGE).toBeGreaterThanOrEqual(
      12,
    );
    expect(runs.finish).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'done',
        summary: 'Summary paragraph.',
      }),
    );
    expect(settings.recordLastRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        status: 'done',
        note: 'Summary paragraph.',
      }),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });

  it('puts the page text, likely code folders and a step budget in the work item', async () => {
    const { service, requests, pages } = setup();
    pages.list.mockResolvedValue([
      page('a'),
      page('b', { surfaces: ['admin'], body: 'THE-PAGE-BODY-TEXT' }),
    ]);
    await service.run({ trigger: 'scheduled', triggeredBy: null });
    const item = String(requests[1].messages[0].content);
    expect(item).toContain('slug b');
    expect(item).toContain('THE-PAGE-BODY-TEXT');
    expect(item).toContain(
      'Likely code folders: ally-web/apps/ally-admin-dashboard',
    );
    expect(item).toContain(
      `you have about ${MANUAL_WEEKLY_LIMITS.MAX_ITERATIONS_PER_PAGE} steps`,
    );
    expect(item).toContain(
      `at most ${MANUAL_WEEKLY_LIMITS.MAX_CODE_LOOKUPS_PER_PAGE} code lookups`,
    );
    expect(item).toContain('do not read it again');
    expect(item).toContain('You cannot edit the page');
    expect(item).toContain('flag_discrepancy');
    expect(item).toContain('Not finding it is not a contradiction');
  });

  it('gives each work item its own lookup budget and saves the tool trace on the item log', async () => {
    const { service, runs, core, tools } = setup();
    expect(tools.getToolDefinitions).not.toHaveBeenCalled();
    tools.execute.mockImplementation(
      async (name: string, _input: unknown, ctx: any) => {
        ctx.trace.push(
          name === 'github_search_code'
            ? { tool: name, ok: false, note: 'rate limited' }
            : { tool: name, ok: true },
        );
        return { ok: true, modelResult: '{}', summary: '' };
      },
    );
    core.run.mockImplementation(async function* (request: ManualLoopRequest) {
      await request.execute('search_manual', {});
      await request.execute('github_search_code', {});
      return { status: 'done', text: '', iterations: 2, costUsd: 0.001 };
    } as never);
    await service.run({ trigger: 'manual', triggeredBy: 7 });
    expect(tools.getToolDefinitions).toHaveBeenCalledWith(
      expect.objectContaining({
        lookupBudget: {
          code: MANUAL_WEEKLY_LIMITS.MAX_CODE_LOOKUPS_PER_PAGE,
          manual: MANUAL_WEEKLY_LIMITS.MAX_MANUAL_LOOKUPS_PER_PAGE,
        },
      }),
    );
    const log = runs.finish.mock.calls[0][1].itemLog;
    expect(log[0].tools).toEqual([
      'search_manual',
      'github_search_code!rate limited',
    ]);
  });

  it('marks a worked-on page as attempted, finished or not, but not one the provider failed on', async () => {
    const { service, core, pages } = setup();
    pages.list.mockResolvedValue([page('a'), page('b')]);
    let n = 0;
    core.run.mockImplementation(async function* () {
      n += 1;
      // call 1 = page "a", call 2 = page "b"
      return n === 2
        ? { status: 'iteration_cap', text: '', iterations: 16, costUsd: 0.01 }
        : { status: 'done', text: '', iterations: 1, costUsd: 0.001 };
    } as never);
    await service.run({ trigger: 'manual', triggeredBy: 7 });
    expect(pages.markAttempted).toHaveBeenCalledWith('a');
    expect(pages.markAttempted).toHaveBeenCalledWith('b');

    const second = setup();
    second.core.run.mockImplementation(async function* () {
      return { status: 'provider_failed', text: '', iterations: 1, costUsd: 0 };
    } as never);
    await second.service.run({ trigger: 'manual', triggeredBy: 7 });
    expect(second.pages.markAttempted).not.toHaveBeenCalled();
  });

  it('cuts a very long page and says so, so one page cannot eat the step budget', async () => {
    const { service, requests, pages } = setup();
    const long =
      'x'.repeat(MANUAL_WEEKLY_LIMITS.MAX_PAGE_CHARS_IN_ITEM) + 'TAIL-MARKER';
    pages.list.mockResolvedValue([page('a'), page('b', { body: long })]);
    await service.run({ trigger: 'scheduled', triggeredBy: null });
    const item = String(requests[1].messages[0].content);
    expect(item).toContain('[the rest of the page is not shown]');
    expect(item).not.toContain('TAIL-MARKER');
  });

  it('records each item’s outcome and how its loop ended on the run row', async () => {
    const { service, runs, core } = setup();
    core.run.mockImplementation(async function* () {
      return {
        status: 'iteration_cap',
        text: '',
        iterations: 12,
        costUsd: 0.0063,
      };
    } as never);
    await service.run({ trigger: 'manual', triggeredBy: 7 });
    const patch = runs.finish.mock.calls[0][1];
    expect(patch.itemLog).toHaveLength(2);
    expect(patch.itemLog[0]).toEqual({
      item: 'Page "a"',
      outcome: 'not_finished',
      status: 'iteration_cap',
      iterations: 12,
      costUsd: 0.0063,
      tools: [],
    });
    expect(patch.itemLog[1]).toMatchObject({
      item: 'Page "b"',
      outcome: 'not_finished',
      status: 'iteration_cap',
    });
    // The log is also saved as the run goes, so a running run shows its items.
    expect(runs.progress).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ itemLog: expect.any(Array) }),
    );
  });

  it('stops cleanly with stop_reason cap when the ledger cannot reserve', async () => {
    const { service, core, runs } = setup();
    core.run.mockImplementation(async function* () {
      return { status: 'budget', text: '', iterations: 1, costUsd: 0 };
    } as never);
    const result = await service.run({ trigger: 'manual', triggeredBy: 7 });
    expect(result.stopReason).toBe('cap');
    expect(runs.finish).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'done', stopReason: 'cap' }),
    );
    // A templated summary: the model could not be paid for.
    expect(runs.finish.mock.calls[0][1].summary).toMatch(/budget ran out/);
  });

  it('never leaves the run running when something throws', async () => {
    const { service, core, runs } = setup();
    core.resolveTarget.mockRejectedValueOnce(new Error('no key'));
    const result = await service.run({ trigger: 'manual', triggeredBy: 7 });
    expect(result.status).toBe('failed');
    expect(runs.finish).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'failed', error: 'no key' }),
    );
  });

  it('templates a plain summary', () => {
    expect(templatedSummary(0, { touched: 0, applied: 0 }, null)).toBe(
      'Nothing needed checking this week.',
    );
    expect(
      templatedSummary(3, { touched: 2, applied: 1 }, 'page_limit'),
    ).toMatch(
      /Looked at 3 items: 2 pages checked or updated, 1 proposal applied\. More pages/,
    );
  });
});

describe('ManualSchedulerRegistrationService.tick', () => {
  const make = (enabled: boolean, claimed: boolean) => {
    const weekly = {
      run: jest.fn().mockResolvedValue({ runId: 'r', status: 'done' }),
    };
    const runs = { claimWeek: jest.fn().mockResolvedValue(claimed) };
    const settings = { get: jest.fn().mockResolvedValue({ enabled }) };
    const svc = new ManualSchedulerRegistrationService(
      weekly as never,
      runs as never,
      settings as never,
    );
    return { svc, weekly, runs };
  };

  it('claims the IST week and runs once; a replica that loses the claim does nothing', async () => {
    const winner = make(true, true);
    await winner.svc.tick(NOW);
    expect(winner.runs.claimWeek).toHaveBeenCalledWith(
      '2026-11-23',
      '2026-11-23',
    );
    expect(winner.weekly.run).toHaveBeenCalledWith({
      trigger: 'scheduled',
      triggeredBy: null,
    });

    const loser = make(true, false);
    await loser.svc.tick(NOW);
    expect(loser.weekly.run).not.toHaveBeenCalled();
  });

  it('lets a switched-off agent record its skip without claiming the week', async () => {
    const off = make(false, true);
    await off.svc.tick(NOW);
    expect(off.runs.claimWeek).not.toHaveBeenCalled();
    expect(off.weekly.run).toHaveBeenCalled();
  });
});

describe('ManualWeeklyAgentService without code access', () => {
  it('checks nothing and says so in the summary', async () => {
    const { service, runs, requests, tools } = setup();
    tools.codeSearchAvailable.mockReturnValue(false);
    await service.run({ trigger: 'scheduled', triggeredBy: null });
    // No code to read: no page is worked, no proposal is worked, no model call at all.
    expect(requests).toHaveLength(0);
    const summary = runs.finish.mock.calls[0][1].summary as string;
    expect(
      summary.startsWith(
        "Code access isn't set up, so no page could be checked against the code.",
      ),
    ).toBe(true);
  });

  it('shares one files-read set across the work items of a run', async () => {
    const { service, tools } = setup();
    await service.run({ trigger: 'scheduled', triggeredBy: null });
    const contexts = tools.getToolDefinitions.mock.calls.map(
      (c: any[]) => c[0],
    );
    expect(contexts.length).toBeGreaterThan(1);
    expect(new Set(contexts.map((c: any) => c.filesRead)).size).toBe(1);
  });
});

describe('ManualWeeklyAgentService never works proposals', () => {
  it('leaves every open proposal open: only pages become work items, and the agent cannot edit', async () => {
    const { service, requests, tools, proposalsMock } = setup() as any;
    proposalsMock.listOpen.mockResolvedValue([
      {
        id: 'gap-1',
        kind: 'gap',
        pageSlug: null,
        summary: 'How?',
        source: 'chat',
        createdAt: daysAgo(3),
      },
      {
        id: 'edit-1',
        kind: 'edit',
        pageSlug: 'a',
        summary: 'Rename',
        source: 'coding_agent',
        createdAt: daysAgo(1),
      },
    ]);
    await service.run({ trigger: 'scheduled', triggeredBy: null });
    const items = requests
      .slice(0, -1)
      .map((r: ManualLoopRequest) => String(r.messages[0].content));
    expect(items).toHaveLength(2);
    expect(
      items.every((t: string) => t.startsWith('Work item: verify the page')),
    ).toBe(true);
    expect(items.join('\n')).not.toContain('edit-1');
    const contexts = tools.getToolDefinitions.mock.calls.map(
      (c: any[]) => c[0],
    );
    expect(
      contexts.every(
        (c: any) => c.editsAllowed === false && c.proposal === null,
      ),
    ).toBe(true);
  });

  it('records a flagged page on the item log instead of marking it checked', async () => {
    const { service, runs, core, tools } = setup();
    tools.execute.mockImplementation(
      async (_n: string, _i: unknown, ctx: any) => {
        ctx.flagged.add('a');
        return { ok: true, modelResult: '{}', summary: '' };
      },
    );
    core.run.mockImplementation(async function* (request: ManualLoopRequest) {
      if (request.metadata?.item === 'Page "a"')
        await request.execute('flag_discrepancy', {});
      return { status: 'done', text: '', iterations: 3, costUsd: 0.002 };
    } as never);
    await service.run({ trigger: 'manual', triggeredBy: 7 });
    const log = runs.finish.mock.calls[0][1].itemLog;
    expect(log[0]).toMatchObject({ item: 'Page "a"', outcome: 'flagged' });
    expect(log[1]).toMatchObject({ item: 'Page "b"', outcome: 'not_finished' });
  });
});
