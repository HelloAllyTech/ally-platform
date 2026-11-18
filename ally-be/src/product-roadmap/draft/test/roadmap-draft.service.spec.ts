import {
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RoadmapNotificationKind } from 'src/product-planning/enum/product-planning.enum';
import { RoadmapDraftService } from '../roadmap-draft.service';
import { DRAFT_CHECK_ORDER } from '../roadmap-draft.util';

const ME = 7;
const SESSION = '00000000-0000-4000-8000-000000000001';

const allGates = DRAFT_CHECK_ORDER.map((id) => ({ id, met: true }));

function draftRow(
  plan: Record<string, any> = {},
  over: Record<string, any> = {},
) {
  return {
    id: SESSION,
    kind: 'plan',
    visibility: 'private',
    createdBy: ME,
    title: 'Idea',
    archivedAt: null,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-02T00:00:00Z'),
    plan: { code: 'OPP-0900', draftText: 'Counsellors retype names', ...plan },
    ...over,
  };
}

function build(opts: { role?: string; row?: any; messages?: any[] } = {}) {
  let row = opts.row ?? draftRow();
  const qb: any = {
    addSelect: () => qb,
    where: () => qb,
    andWhere: () => qb,
    orderBy: () => qb,
    take: () => qb,
    getOne: jest.fn(async () => row),
    getMany: jest.fn(async () => (row ? [row] : [])),
  };
  const deps = {
    dataSource: {
      query: jest.fn<Promise<any>, any[]>(async () => []),
    },
    settings: {},
    roles: { roleOf: jest.fn(async () => opts.role ?? 'idea') },
    store: {
      repository: {
        createQueryBuilder: () => qb,
        update: jest.fn(),
        delete: jest.fn(),
      },
      get: jest.fn(async () => row),
      find: jest.fn(async () => row),
      patchPlan: jest.fn(async (_id: string, patch: any) => {
        row = { ...row, plan: { ...row.plan, ...patch } };
      }),
      update: jest.fn(),
    },
    stage: { sync: jest.fn() },
    builderSessions: {
      createSession: jest.fn(async () => ({ id: SESSION })),
      attachHandoffContext: jest.fn(),
    },
    messages: {
      appendMessage: jest.fn(async (_id: string, m: any) => ({
        id: 'm',
        ...m,
      })),
      listBySession: jest.fn(async () => opts.messages ?? []),
    },
    copilot: { takeTurn: jest.fn() },
    opportunityService: { create: jest.fn(async () => ({ id: 'opp-1' })) },
    readinessToken: { issue: jest.fn(() => 'signed') },
    roadmapBuilder: { handoffTextForOpportunity: jest.fn(async () => null) },
    roadmapAi: { findDuplicates: jest.fn(async () => ({ matches: [] })) },
    allocations: { setVotes: jest.fn() },
    comments: { create: jest.fn(async () => ({ id: 'c1' })) },
    events: { record: jest.fn() },
    spend: {
      checkCeiling: jest.fn(async () => ({
        state: 'ok',
        spentUsd: 0.1,
        ceilingUsd: 1,
      })),
      record: jest.fn(),
    },
    ceiling: { assertWithinCeiling: jest.fn() },
    inbox: { deliver: jest.fn() },
    broadcast: { emit: jest.fn() },
    lookup: { get: jest.fn() },
    reader: {
      detail: jest.fn(async () => ({ code: 'OPP-0900' })),
      rowsFor: jest.fn(async () => []),
    },
  };
  const service = new RoadmapDraftService(
    ...(Object.values(deps) as unknown as ConstructorParameters<
      typeof RoadmapDraftService
    >),
  );
  return { service, deps, row: () => row };
}

describe('RoadmapDraftService', () => {
  it('New idea needs the Idea role and allocates the code it keeps for life, with no AI', async () => {
    const viewer = build({ role: 'viewer' });
    await expect(
      viewer.service.create(ME, { text: 'An idea' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const { service, deps } = build();
    deps.dataSource.query.mockResolvedValueOnce([{ code: 'OPP-0900' }]);
    const draft = await service.create(ME, { text: 'An idea\nmore' });
    expect(deps.dataSource.query.mock.calls[0][0]).toContain(
      "nextval('roadmap_opportunity_code_seq')",
    );
    expect(deps.store.patchPlan).toHaveBeenCalledWith(
      SESSION,
      expect.objectContaining({ code: 'OPP-0900', draftVersion: 1 }),
    );
    expect(deps.copilot.takeTurn).not.toHaveBeenCalled();
    expect(draft.code).toBe('OPP-0900');
  });

  it("someone else's draft is a 404, never a 403", async () => {
    const { service } = build({ row: draftRow({}, { createdBy: 99 }) });
    await expect(service.detail(ME, 'OPP-0900')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses a stale autosave with the current draft', async () => {
    const { service, deps } = build();
    deps.dataSource.query.mockResolvedValueOnce([[], 0]);
    const error = await service
      .patch(ME, 'OPP-0900', { text: 'new', baseVersion: 3 })
      .catch((e) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({
      code: 'draft_version_conflict',
      current: { code: 'OPP-0900' },
    });
  });

  it('a repeated idempotency key runs no second turn', async () => {
    const { service, deps } = build();
    deps.dataSource.query.mockResolvedValueOnce([{ '?column?': 1 }]);
    await service.turn(ME, 'OPP-0900', {
      answer: 'again',
      idempotencyKey: 'key-123456',
    });
    expect(deps.copilot.takeTurn).not.toHaveBeenCalled();
    expect(deps.messages.appendMessage).not.toHaveBeenCalled();
  });

  it('Check my idea keeps verified quotes and the goal suggestion from the same turn', async () => {
    const { service, deps, row } = build();
    deps.copilot.takeTurn.mockResolvedValue({
      reply: 'What would tell us it worked?',
      gates: allGates,
      draft: null,
      brief: null,
      readinessToken: null,
      checkTurn: {
        evidence: { who_it_affects: 'Counsellors', clear_why: 'paraphrase' },
        suggestedGoal: 'Scribe',
      },
    });
    await service.turn(ME, 'OPP-0900', {});
    expect(deps.copilot.takeTurn).toHaveBeenCalledWith(
      expect.objectContaining({ checks: { reopened: [] } }),
      ME,
    );
    expect(row().plan.idea).toMatchObject({
      evidence: { who_it_affects: 'Counsellors' },
      suggestedGoal: 'Scribe',
      turnFailures: 0,
    });
  });

  it('counts assistant failures so the page can offer Fill it in yourself', async () => {
    const { service, deps, row } = build({
      row: draftRow({ idea: { turnFailures: 1 } }),
    });
    deps.copilot.takeTurn.mockRejectedValue(
      new ServiceUnavailableException('down'),
    );
    const error = await service.turn(ME, 'OPP-0900', {}).catch((e) => e);
    expect(error.getStatus()).toBe(503);
    expect(error.getResponse()).toMatchObject({
      code: 'assistant_unavailable',
      failures: 2,
      selfCheckOffered: true,
    });
    expect(row().plan.idea.turnFailures).toBe(2);
  });

  it('Submit refuses anything short of 5 of 5', async () => {
    const { service, deps } = build();
    const error = await service.submit(ME, 'OPP-0900', {}).catch((e) => e);
    expect(error.getStatus()).toBe(422);
    expect(error.getResponse()).toMatchObject({ code: 'checks_incomplete' });
    expect(deps.opportunityService.create).not.toHaveBeenCalled();
  });

  it('Submit files with the same code, pending review, shared, and tells the Owners', async () => {
    const { service, deps } = build({
      row: draftRow({
        draftGoalId: 'g1',
        idea: {
          gates: allGates,
          brief: { assessment: { rating: 'promising' } },
          draft: { description: 'x', productGoal: 'Scribe', effort: 'm' },
        },
      }),
    });
    deps.dataSource.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM "roadmap_product_goals"'))
        return [{ id: 'g1', name: 'Scribe' }];
      if (sql.includes("jsonb_build_object('filingAt'"))
        return [[{ id: SESSION }], 1];
      if (sql.includes('count(*)')) return [{ n: 0 }];
      return [];
    });
    const result = await service.submit(ME, 'OPP-0900', {});
    expect(deps.opportunityService.create).toHaveBeenCalledWith(
      ME,
      expect.objectContaining({
        description: 'Counsellors retype names',
        productGoal: 'Scribe',
        readinessToken: 'signed',
      }),
      expect.objectContaining({ code: 'OPP-0900', enforceReadiness: true }),
    );
    expect(
      deps.dataSource.query.mock.calls.some(([sql]) =>
        String(sql).includes(`"reviewState" = 'pending'`),
      ),
    ).toBe(true);
    expect(deps.store.update).toHaveBeenCalledWith(
      SESSION,
      expect.objectContaining({ visibility: 'shared' }),
    );
    expect(deps.inbox.deliver).toHaveBeenCalledWith(
      expect.objectContaining({ kind: RoadmapNotificationKind.SUBMITTED }),
    );
    expect(result.firstSubmit).toBe(true);
  });

  it('a self-checked draft files unsigned, with its five answers, marked selfChecked', async () => {
    const selfCheck = Object.fromEntries(
      DRAFT_CHECK_ORDER.map((id) => [id, `answer ${id}`]),
    );
    const { service, deps } = build({
      row: draftRow({ draftGoalId: 'g1', idea: { selfCheck } }),
    });
    deps.dataSource.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM "roadmap_product_goals"'))
        return [{ id: 'g1', name: 'Scribe' }];
      if (sql.includes("jsonb_build_object('filingAt'"))
        return [[{ id: SESSION }], 1];
      if (sql.includes('count(*)')) return [{ n: 2 }];
      return [];
    });
    const result = await service.submit(ME, 'OPP-0900', {});
    const [, dto, extra] = deps.opportunityService.create.mock
      .calls[0] as any[];
    expect(extra.enforceReadiness).toBe(false);
    expect(dto.readinessToken).toBeUndefined();
    expect(dto.description).toContain("Who it's for: answer who_it_affects");
    const update = deps.dataSource.query.mock.calls.find(([sql]) =>
      String(sql).includes(`"reviewState" = 'pending'`),
    ) as any[];
    expect(update[1]).toEqual(['opp-1', true, SESSION]);
    expect(result.firstSubmit).toBe(false);
  });
});
