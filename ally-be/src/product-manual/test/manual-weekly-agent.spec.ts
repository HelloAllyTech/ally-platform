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
  const pages = { list: jest.fn().mockResolvedValue([page('a'), page('b')]) };
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
    // proposal (page a covered), page b, then the summary call.
    expect(requests).toHaveLength(3);
    expect(requests[0].messages[0].content).toContain('proposal prop-1');
    expect(requests[1].messages[0].content).toContain('slug b');
    expect(requests.every((r) => r.gate === requests[0].gate)).toBe(true);
    expect(requests[0].maxIterations).toBe(8);
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
  it('works open proposals only and says so in the summary', async () => {
    const { service, runs, requests, tools } = setup();
    tools.codeSearchAvailable.mockReturnValue(false);
    await service.run({ trigger: 'scheduled', triggeredBy: null });
    // One proposal item, then the summary call: no page items at all.
    expect(requests).toHaveLength(2);
    expect(requests[0].messages[0].content).toContain('proposal prop-1');
    const summary = runs.finish.mock.calls[0][1].summary as string;
    expect(
      summary.startsWith(
        "Code access isn't set up, so only proposals were applied.",
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

describe('ManualWeeklyAgentService gaps without code access', () => {
  it('leaves gap proposals open, unqueued, and counts them in the summary', async () => {
    const { service, runs, requests, tools, proposalsMock } = setup() as any;
    tools.codeSearchAvailable.mockReturnValue(false);
    proposalsMock.listOpen.mockResolvedValueOnce([
      {
        id: 'gap-1',
        kind: 'gap',
        pageSlug: null,
        summary: 'How?',
        source: 'chat',
        createdAt: daysAgo(3),
      },
      {
        id: 'gap-2',
        kind: 'gap',
        pageSlug: null,
        summary: 'Why?',
        source: 'chat',
        createdAt: daysAgo(2),
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
    expect(requests).toHaveLength(2); // edit-1, then the summary
    expect(requests[0].messages[0].content).toContain('proposal edit-1');
    const summary = runs.finish.mock.calls[0][1].summary as string;
    expect(summary).toContain(
      "Code access isn't set up, so only proposals were applied. 2 questions from the chat were left open: answering them needs code access.",
    );
  });

  it('frames a gap work item as a question when the code can be read', async () => {
    const { service, requests, proposalsMock } = setup() as any;
    proposalsMock.listOpen.mockResolvedValueOnce([
      {
        id: 'gap-1',
        kind: 'gap',
        pageSlug: null,
        summary: 'How?',
        source: 'chat',
        createdAt: daysAgo(3),
      },
    ]);
    await service.run({ trigger: 'scheduled', triggeredBy: null });
    expect(requests[0].messages[0].content).toContain('This is a QUESTION');
  });
});
