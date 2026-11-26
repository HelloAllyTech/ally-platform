import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ManualImportService } from '../service/manual-import.service';
import { ManualProposalService } from '../service/manual-proposal.service';
import { ManualScrubService } from '../service/manual-scrub.service';
import { ManualSettingsService } from '../service/manual-settings.service';
import { ManualStateService } from '../service/manual-state.service';
import { ManualWriteError } from '../type/manual.types';

describe('ManualStateService.state', () => {
  function build(opts: {
    enabled?: boolean;
    running?: boolean;
    exhausted?: boolean;
    toggles?: string[];
  }) {
    const runs = {
      exist: jest.fn(async () => opts.running === true),
      find: jest.fn(),
    };
    const settings = {
      get: jest.fn(async () => ({
        enabled: opts.enabled ?? true,
        monthlyBudgetUsd: 100,
        lastRun: null,
      })),
    };
    const budget = {
      snapshot: jest.fn(async () => ({
        monthlyBudgetUsd: 100,
        spentUsd: opts.exhausted ? 100 : 12,
        reservedUsd: 0,
        exhausted: opts.exhausted === true,
        approximate: false,
      })),
    };
    const proposals = {
      countOpen: jest.fn(async () => ({ proposals: 4, gaps: 2 })),
    };
    const toggles = {
      hasToggle: jest.fn(async (_u: number, key: string) =>
        (opts.toggles ?? []).includes(key),
      ),
    };
    return new ManualStateService(
      runs as never,
      settings as never,
      budget as never,
      proposals as never,
      toggles as never,
    );
  }
  const now = new Date('2026-11-26T10:00:00Z'); // a Thursday

  it('precedence is disabled > running > budget_exhausted > idle', async () => {
    expect(
      (
        await build({ enabled: false, running: true, exhausted: true }).state(
          1,
          now,
        )
      ).agentState,
    ).toBe('disabled');
    expect(
      (await build({ running: true, exhausted: true }).state(1, now))
        .agentState,
    ).toBe('running');
    expect((await build({ exhausted: true }).state(1, now)).agentState).toBe(
      'budget_exhausted',
    );
    expect((await build({}).state(1, now)).agentState).toBe('idle');
  });

  it('shows the banner only when the budget is used up', async () => {
    expect((await build({ exhausted: true }).state(1, now)).banner).toBe(
      "Weekly updates are paused: this month's budget is used up. They resume on the 1st.",
    );
    expect((await build({}).state(1, now)).banner).toBeNull();
    expect(
      (await build({ enabled: false, exhausted: true }).state(1, now)).banner,
    ).toBeNull();
  });

  it('reports the next Monday 02:00 UTC, or null while disabled', async () => {
    expect((await build({}).state(1, now)).nextRunAt).toBe(
      '2026-11-30T02:00:00.000Z',
    );
    expect(
      (await build({ enabled: false }).state(1, now)).nextRunAt,
    ).toBeNull();
  });

  it('carries counts, budget and the caller flags from their toggles', async () => {
    const state = await build({ toggles: ['analytics_agent'] }).state(7, now);
    expect(state).toMatchObject({
      openProposals: 4,
      openGaps: 2,
      analyticsAvailable: true,
      canAdminister: false,
      budget: { monthlyBudgetUsd: 100, spentUsd: 12, reservedUsd: 0 },
    });
    expect(
      (await build({ toggles: ['product_roadmap_manage'] }).state(7, now))
        .canAdminister,
    ).toBe(true);
  });
});

describe('ManualImportService', () => {
  const ok = (created: boolean, changed: boolean) => ({
    created,
    changed,
    page: {},
    revision: null,
  });

  it('counts created / updated / unchanged and collects per-page errors without aborting', async () => {
    const write = jest
      .fn()
      .mockResolvedValueOnce(ok(true, true))
      .mockResolvedValueOnce(ok(false, true))
      .mockResolvedValueOnce(ok(false, false))
      .mockRejectedValueOnce(
        new ManualWriteError('scrubbed', 'Line 1 contains an email address.'),
      )
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce(ok(true, true));
    const service = new ManualImportService({ write } as never);
    const result = await service.import(
      [
        { slug: 'a' },
        { slug: 'b' },
        { slug: 'c' },
        { slug: 'd' },
        { slug: 'e' },
        { slug: 'f' },
      ] as never,
      3,
    );
    expect(result).toEqual({
      created: 2,
      updated: 1,
      unchanged: 1,
      errors: [
        'd: Line 1 contains an email address.',
        'e: could not be saved.',
      ],
    });
    // Seed author: never marks pages "next".
    expect(write.mock.calls[0][1]).toMatchObject({ kind: 'seed' });
    expect(write.mock.calls[0][2]).toBe(3);
  });

  it('accepts a child before its parent (no parent check at write time)', async () => {
    const write = jest.fn().mockResolvedValue(ok(true, true));
    await new ManualImportService({ write } as never).import(
      [
        { slug: 'child', title: 'C', parentSlug: 'parent' },
        { slug: 'parent', title: 'P' },
      ] as never,
      1,
    );
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('refuses an empty list and more than 200 pages', async () => {
    const service = new ManualImportService({ write: jest.fn() } as never);
    await expect(service.import([], 1)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.import(
        Array.from({ length: 201 }, (_, i) => ({ slug: `p${i}`, title: 'T' })),
        1,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports a malformed entry instead of throwing', async () => {
    const service = new ManualImportService({ write: jest.fn() } as never);
    const result = await service.import([null, 'x'] as never, 1);
    expect(result.errors).toHaveLength(2);
  });
});

describe('ManualProposalService', () => {
  function build() {
    const repo: any = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: 'p1', ...x })),
      find: jest.fn(async () => []),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    return {
      repo,
      service: new ManualProposalService(repo, new ManualScrubService()),
    };
  }
  const base = {
    kind: 'edit' as const,
    summary: 'Rename the button',
    source: 'coding_agent' as const,
  };

  it('creates an open proposal with trimmed text', async () => {
    const { service, repo } = build();
    const saved = await service.create({
      ...base,
      summary: '  Rename the button  ',
      pageSlug: 'x',
      prRef: 'PR 12',
    });
    expect(saved).toMatchObject({
      id: 'p1',
      status: 'open',
      summary: 'Rename the button',
      pageSlug: 'x',
      detail: '',
    });
    expect(repo.save).toHaveBeenCalled();
  });

  it.each([
    [{ ...base, summary: '   ' }, 'invalid'],
    [{ ...base, kind: 'nope' as never }, 'invalid'],
    [{ ...base, pageSlug: 'Bad Slug' }, 'invalid_slug'],
    [{ ...base, summary: 'contact me@x.org' }, 'scrubbed'],
    [{ ...base, detail: 'x'.repeat(20_001) }, 'too_large'],
  ])('refuses %# with a ManualWriteError', async (input, code) => {
    const { service, repo } = build();
    await expect(service.create(input as never)).rejects.toMatchObject({
      code,
    });
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('listOpen asks for open rows oldest first; list takes an optional status, newest first', async () => {
    const { service, repo } = build();
    await service.listOpen(10);
    expect(repo.find).toHaveBeenLastCalledWith({
      where: { status: 'open' },
      order: { createdAt: 'ASC' },
      take: 10,
    });
    await service.list('applied', 5);
    expect(repo.find).toHaveBeenLastCalledWith({
      where: { status: 'applied' },
      order: { createdAt: 'DESC' },
      take: 5,
    });
    await service.list();
    expect(repo.find).toHaveBeenLastCalledWith({
      where: {},
      order: { createdAt: 'DESC' },
      take: 100,
    });
    expect(() => service.list('weird' as never)).toThrow(ManualWriteError);
  });

  it('dismiss only touches open proposals and 404s otherwise', async () => {
    const { service, repo } = build();
    await service.dismiss('p1');
    expect(repo.update).toHaveBeenCalledWith(
      { id: 'p1', status: 'open' },
      expect.objectContaining({ status: 'dismissed' }),
    );
    repo.update.mockResolvedValueOnce({ affected: 0 });
    await expect(service.dismiss('p1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('markApplied records the revision', async () => {
    const { service, repo } = build();
    await service.markApplied('p1', 'rev-1');
    expect(repo.update).toHaveBeenCalledWith(
      { id: 'p1', status: 'open' },
      expect.objectContaining({
        status: 'applied',
        appliedRevisionId: 'rev-1',
      }),
    );
  });

  it('countOpen splits gaps from proposals', async () => {
    const { service, repo } = build();
    const qb: any = {
      select: () => qb,
      addSelect: () => qb,
      where: () => qb,
      groupBy: () => qb,
      getRawMany: async () => [
        { kind: 'edit', n: '3' },
        { kind: 'new_page', n: '1' },
        { kind: 'gap', n: '2' },
      ],
    };
    repo.createQueryBuilder = () => qb;
    expect(await service.countOpen()).toEqual({ proposals: 4, gaps: 2 });
  });
});

describe('ManualSettingsService.update', () => {
  function build(
    row: any = { id: 1, enabled: false, monthlyBudgetUsd: '100.00' },
  ) {
    const repo: any = {
      findOne: jest.fn(async () => row),
      save: jest.fn(async (r) => r),
    };
    return { repo, service: new ManualSettingsService(repo) };
  }

  it('turns the agent on and sets a budget, recording who', async () => {
    const { service, repo } = build();
    const view = await service.update(
      { enabled: true, monthlyBudgetUsd: 250 },
      9,
    );
    expect(view).toMatchObject({
      enabled: true,
      monthlyBudgetUsd: 250,
      updatedBy: 9,
    });
    expect(repo.save).toHaveBeenCalled();
  });

  it.each([0, 0.5, 2001, NaN, Infinity])(
    'refuses a budget of %p',
    async (usd) => {
      const { service, repo } = build();
      await expect(
        service.update({ monthlyBudgetUsd: usd }, 1),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    },
  );

  it('accepts the 1 and 2000 USD edges', async () => {
    const { service } = build();
    await expect(
      service.update({ monthlyBudgetUsd: 1 }, 1),
    ).resolves.toMatchObject({ monthlyBudgetUsd: 1 });
    await expect(
      service.update({ monthlyBudgetUsd: 2000 }, 1),
    ).resolves.toMatchObject({ monthlyBudgetUsd: 2000 });
  });

  it('get() returns numbers, not numeric strings', async () => {
    const { service } = build({
      id: 1,
      enabled: true,
      monthlyBudgetUsd: '75.50',
      lastRun: null,
      updatedAt: new Date(),
    });
    expect(await service.get()).toMatchObject({
      enabled: true,
      monthlyBudgetUsd: 75.5,
    });
  });
});
