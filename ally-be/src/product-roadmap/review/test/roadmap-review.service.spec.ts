import {
  ConflictException,
  ForbiddenException,
  HttpException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PlanEventKind,
  RoadmapNotificationKind,
} from 'src/product-planning/enum/product-planning.enum';
import { RoadmapReviewService } from '../roadmap-review.service';
import { REVIEW_NOTICE_DELAY_MS } from '../roadmap-review.util';

const OWNER = 1;
const BUILDER = 2;
const AUTHOR = 3;

function build(
  opts: {
    roles?: Record<number, string>;
    stage?: string;
    can?: Record<string, boolean>;
    lead?: number | null;
  } = {},
) {
  const roles = opts.roles ?? { [OWNER]: 'owner', [BUILDER]: 'builder' };
  const items: Record<string, any> = {};
  const detail = (code: string) =>
    (items[code] ??= {
      code,
      shownStage: opts.stage ?? 'submitted',
      can: { review: true, pickLead: true, ...(opts.can ?? {}) },
    });
  const txQueries: [string, any[]][] = [];
  const manager = {
    query: jest.fn(async (sql: string, params: any[]): Promise<any> => {
      txQueries.push([sql, params]);
      if (sql.includes('RETURNING id')) return [[{ id: params[0] }], 1];
      return [];
    }),
  };
  // What a re-read of the item finds when a held notice fires.
  const db: { state: string } = { state: 'pending' };
  const deps = {
    dataSource: {
      query: jest.fn(async (sql: string): Promise<any> => {
        if (
          sql.includes('"createdBy"') &&
          sql.includes('FROM "roadmap_opportunities"')
        )
          return [{ reviewState: 'pending', createdBy: AUTHOR }];
        if (sql.startsWith('SELECT "reviewState"'))
          return [{ reviewState: db.state }];
        return [];
      }),
      transaction: jest.fn(async (fn: any) => fn(manager)),
    },
    config: { jwt: { accessToken: { secret: 'secret' } } },
    settings: { getRoadmapV2: jest.fn(async () => ({ inProgressLimit: 3 })) },
    roles: {
      roleOf: jest.fn(async (id: number) => roles[id] ?? 'idea'),
      owners: jest.fn(async () => [OWNER]),
      leadCandidates: jest.fn(async () => [BUILDER]),
    },
    lookup: {
      get: jest.fn(async (code: string) => ({
        id: `id-${code}`,
        code,
        createdBy: AUTHOR,
        builderSessionId: `s-${code}`,
      })),
    },
    reader: {
      detail: jest.fn(async (_u: number, code: string) => detail(code)),
      rowsFor: jest.fn(async (_u: number, ids: string[]) =>
        ids.map((id) => ({ code: id })),
      ),
    },
    drafts: { similarTo: jest.fn() },
    store: {
      find: jest.fn(async (id: string) => ({
        id,
        leadUserId: opts.lead ?? null,
        plan: {},
      })),
      update: jest.fn(),
      patchPlan: jest.fn(),
    },
    stage: { sync: jest.fn() },
    events: { record: jest.fn() },
    inbox: { deliver: jest.fn() },
    broadcast: { emit: jest.fn() },
    strategyGoals: { invalidate: jest.fn() },
  };
  const service = new RoadmapReviewService(
    ...(Object.values(deps) as unknown as ConstructorParameters<
      typeof RoadmapReviewService
    >),
  );
  return { service, deps, txQueries, manager, db };
}

describe('RoadmapReviewService', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('only an Owner reviews', async () => {
    const { service } = build({ roles: { [OWNER]: 'builder' } });
    await expect(
      service.review(OWNER, { code: 'OPP-0001', decision: 'accept' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('decline needs a one-line reason, kept out of the event and given to the inbox as author-only', async () => {
    const { service, deps, db } = build();
    db.state = 'declined';
    await expect(
      service.review(OWNER, { code: 'OPP-0001', decision: 'decline' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    await service.review(OWNER, {
      code: 'OPP-0001',
      decision: 'decline',
      reason: 'Overlaps OPP-0212; add your case there',
    });
    expect(deps.events.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: PlanEventKind.REVIEWED,
        detail: { decision: 'decline' },
      }),
    );
    // Held while the undo window is open.
    expect(deps.inbox.deliver).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(REVIEW_NOTICE_DELAY_MS);
    expect(deps.inbox.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: RoadmapNotificationKind.DECLINED,
        payload: expect.objectContaining({
          reason: 'Overlaps OPP-0212; add your case there',
        }),
      }),
    );
  });

  describe('accepted and declined notices wait out the undo window', () => {
    const noticeKinds = (deps: any) =>
      deps.inbox.deliver.mock.calls.map(([e]: any[]) => e.kind);

    it('sends one accepted notice after the window, and only then', async () => {
      const { service, deps, db } = build();
      db.state = 'accepted';
      await service.review(OWNER, { code: 'OPP-0001', decision: 'accept' });
      await jest.advanceTimersByTimeAsync(REVIEW_NOTICE_DELAY_MS - 1);
      expect(noticeKinds(deps)).not.toContain(RoadmapNotificationKind.ACCEPTED);
      await jest.advanceTimersByTimeAsync(1);
      expect(noticeKinds(deps)).toEqual([RoadmapNotificationKind.ACCEPTED]);
    });

    it('sends nothing when the decision is undone inside the window', async () => {
      const { service, deps, manager } = build();
      const { undoToken } = await service.review(OWNER, {
        code: 'OPP-0001',
        decision: 'accept',
      });
      manager.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT "reviewState"'))
          return [{ reviewState: 'accepted' }];
        if (sql.includes('SELECT "leadUserId"')) return [{ leadUserId: null }];
        return [];
      });
      await service.undo(OWNER, undoToken);
      await jest.advanceTimersByTimeAsync(REVIEW_NOTICE_DELAY_MS * 2);
      expect(deps.inbox.deliver).not.toHaveBeenCalled();
    });

    it('sends nothing when the idea is no longer in the decided state', async () => {
      const { service, deps, db } = build();
      db.state = 'pending'; // undone elsewhere
      await service.review(OWNER, { code: 'OPP-0001', decision: 'accept' });
      await jest.advanceTimersByTimeAsync(REVIEW_NOTICE_DELAY_MS);
      expect(deps.inbox.deliver).not.toHaveBeenCalled();
    });
  });

  it('accept with a lead assigns in the same transaction and tells the lead', async () => {
    const { service, deps, txQueries } = build();
    const { undoToken } = await service.review(OWNER, {
      code: 'OPP-0001',
      decision: 'accept',
      leadUserId: BUILDER,
    });
    expect(undoToken).toMatch(/\./);
    expect(
      txQueries.some(
        ([sql, p]) =>
          sql.includes('UPDATE "builder_sessions"') && p[1] === BUILDER,
      ),
    ).toBe(true);
    expect(deps.events.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: PlanEventKind.LEAD_ASSIGNED }),
    );
    expect(deps.inbox.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: RoadmapNotificationKind.ASSIGNED_TO_YOU,
        directRecipientIds: [BUILDER],
      }),
    );
  });

  it('refuses a lead who is not a Builder or Owner', async () => {
    const { service } = build();
    await expect(
      service.review(OWNER, {
        code: 'OPP-0001',
        decision: 'accept',
        leadUserId: AUTHOR,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('loses cleanly to another Owner reviewing the same idea', async () => {
    const { service, manager } = build();
    manager.query.mockResolvedValueOnce([[], 0]);
    await expect(
      service.review(OWNER, { code: 'OPP-0001', decision: 'accept' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('a batch is all or nothing', async () => {
    const { service, deps } = build();
    deps.reader.detail.mockImplementation(async (_u: number, code: string) => ({
      code,
      shownStage: code === 'OPP-0002' ? 'accepted' : 'submitted',
      can: { review: code !== 'OPP-0002' },
    }));
    const error = await service
      .reviewBatch(OWNER, [
        { code: 'OPP-0001', decision: 'accept' },
        { code: 'OPP-0002', decision: 'accept' },
      ])
      .catch((e) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getResponse()).toMatchObject({
      code: 'batch_rejected',
      failures: [{ code: 'OPP-0002' }],
    });
    expect(deps.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('one undo token reverses a whole batch, and only for the Owner who did it', async () => {
    const { service, deps, manager } = build();
    const { undoToken } = await service.reviewBatch(OWNER, [
      { code: 'OPP-0001', decision: 'accept' },
      { code: 'OPP-0003', decision: 'decline', reason: 'Too small' },
    ]);
    await expect(service.undo(BUILDER, undoToken)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    manager.query.mockImplementation(async (sql: string, p: any[]) => {
      if (sql.includes('SELECT "reviewState"')) {
        return [
          { reviewState: p[0] === 'id-OPP-0001' ? 'accepted' : 'declined' },
        ];
      }
      if (sql.includes('SELECT "leadUserId"')) return [{ leadUserId: null }];
      return [];
    });
    await service.undo(OWNER, undoToken);
    const restores = manager.query.mock.calls.filter(
      ([sql, p]) =>
        String(sql).startsWith('UPDATE "roadmap_opportunities"') &&
        p[1] === 'pending',
    );
    expect(restores).toHaveLength(2);
    expect(deps.reader.rowsFor).toHaveBeenLastCalledWith(OWNER, [
      'id-OPP-0001',
      'id-OPP-0003',
    ]);
  });

  it('undo refuses once something has moved', async () => {
    const { service, manager } = build();
    const { undoToken } = await service.review(OWNER, {
      code: 'OPP-0001',
      decision: 'accept',
    });
    manager.query.mockImplementation(async (sql: string) =>
      sql.includes('SELECT "reviewState"')
        ? [{ reviewState: 'accepted' }]
        : sql.includes('SELECT "leadUserId"')
          ? [{ leadUserId: null, planningStarted: 'true' }]
          : [],
    );
    const error = await service.undo(OWNER, undoToken).catch((e) => e);
    expect(error.getResponse()).toMatchObject({ code: 'undo_conflict' });
  });

  it('only the lead hands an idea back, and it returns to the Owners', async () => {
    const { service, deps } = build({ lead: BUILDER, stage: 'planning' });
    await expect(
      service.lead(OWNER, 'OPP-0001', { action: 'handBack' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await service.lead(BUILDER, 'OPP-0001', {
      action: 'handBack',
      note: 'No time this month',
    });
    expect(deps.store.update).toHaveBeenCalledWith('s-OPP-0001', {
      leadUserId: null,
      updatedBy: BUILDER,
    });
    expect(deps.events.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: PlanEventKind.LEAD_HANDED_BACK }),
    );
    expect(deps.inbox.deliver).toHaveBeenCalledWith(
      expect.objectContaining({ kind: RoadmapNotificationKind.HANDED_BACK }),
    );
  });

  it('suggests the lead with free slots and history, deterministically', async () => {
    const { service, deps } = build();
    deps.dataSource.query.mockImplementation(async (sql: string) => {
      if (sql.includes('GROUP BY "leadUserId"'))
        return [{ leadUserId: BUILDER, n: 1 }];
      if (sql.includes('JOIN "item_releases"'))
        return [{ leadUserId: BUILDER, app: 'admin', n: 4 }];
      if (sql.includes('FROM "users"')) return [{ id: BUILDER, name: 'Priya' }];
      return [];
    });
    const result = await service.leadSuggestions(OWNER, 'OPP-0001');
    expect(result.suggestedUserId).toBe(BUILDER);
    expect(result.candidates[0]).toMatchObject({
      user: { id: BUILDER, name: 'Priya' },
      freeSlots: 2,
      limit: 3,
      matchingIdeas: 4,
      appsTouched: ['admin'],
    });
  });

  it('Start planning: the lead or an Owner; an Owner with no lead takes it', async () => {
    const { service, deps } = build({
      stage: 'accepted',
      can: { startPlanning: true },
    });
    await service.startPlanning(OWNER, 'OPP-0001');
    expect(deps.store.update).toHaveBeenCalledWith('s-OPP-0001', {
      leadUserId: OWNER,
      updatedBy: OWNER,
    });
    expect(deps.store.patchPlan).toHaveBeenCalledWith(
      's-OPP-0001',
      expect.objectContaining({
        planningStarted: true,
        planningStartedBy: OWNER,
      }),
    );
    expect(deps.events.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: PlanEventKind.PLANNING_STARTED }),
    );

    const refused = build({ stage: 'accepted', can: { startPlanning: false } });
    await expect(
      refused.service.startPlanning(AUTHOR, 'OPP-0001'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
