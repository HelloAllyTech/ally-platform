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
    /** The idea has no plan session yet (filed outside the guided interview). */
    noSession?: boolean;
  } = {},
) {
  const roles = opts.roles ?? { [OWNER]: 'owner', [BUILDER]: 'builder' };
  const items: Record<string, any> = {};
  const detail = (code: string) =>
    (items[code] ??= {
      code,
      shownStage: opts.stage ?? 'submitted',
      can: {
        review: true,
        decline: true,
        pickLead: true,
        ...(opts.can ?? {}),
      },
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
        if (sql.startsWith('UPDATE "roadmap_opportunities"'))
          return [[{ id: 'id' }], 1];
        if (sql.includes('SELECT description'))
          return [{ description: 'Tell me why I am blocked.\nMore.' }];
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
        builderSessionId: opts.noSession ? null : `s-${code}`,
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
      repository: { update: jest.fn() },
      // The idea's linked session (plan or older Builder interview): same rows here.
      findLinked: jest.fn(
        async (id: string): Promise<unknown> =>
          (deps.store.find as jest.Mock)(id),
      ),
    },
    stage: { sync: jest.fn() },
    events: { record: jest.fn() },
    inbox: { deliver: jest.fn() },
    broadcast: { emit: jest.fn() },
    strategyGoals: { invalidate: jest.fn() },
    builderSessions: {
      createSession: jest.fn(async () => ({ id: 'new-session' })),
    },
    ideaNotices: {
      planningStarted: jest.fn(async () => undefined),
      planClosed: jest.fn(async () => undefined),
    },
    planTurns: { queueOpeningTurn: jest.fn() },
    closeReadiness: {
      checkClose: jest.fn(
        async (): Promise<{ reason: string; blockers: string[] } | null> =>
          null,
      ),
    },
    planHandoff: { attachAtStart: jest.fn(async () => true) },
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

  it('never assigns a builder at review: the plan comes first (lifecycle 2026-11-18)', async () => {
    const { service, deps, txQueries } = build();
    await expect(
      service.review(OWNER, {
        code: 'OPP-0001',
        decision: 'accept',
        leadUserId: BUILDER,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(
      txQueries.some(([sql]) => sql.includes('UPDATE "builder_sessions"')),
    ).toBe(false);
    expect(deps.events.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: PlanEventKind.LEAD_ASSIGNED }),
    );
  });

  it('declines an idea already being planned or built, but not a released one', async () => {
    const planning = build({ stage: 'planning', can: { review: false } });
    await planning.service.review(OWNER, {
      code: 'OPP-0001',
      decision: 'decline',
      reason: 'Folded into the re-entry work.',
    });
    expect(
      planning.txQueries.some(
        ([sql, p]) =>
          sql.includes('UPDATE "roadmap_opportunities"') && p[1] === 'declined',
      ),
    ).toBe(true);

    const shipped = build({
      stage: 'shipped',
      can: { review: false, decline: false },
    });
    await expect(
      shipped.service.review(OWNER, {
        code: 'OPP-0001',
        decision: 'decline',
        reason: 'Too late.',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  describe('picking a lead on an idea with no plan session', () => {
    it('creates the session, links it to the idea and assigns the lead', async () => {
      const { service, deps } = build({ noSession: true, stage: 'accepted' });
      await service.lead(OWNER, 'OPP-0001', {
        action: 'assign',
        leadUserId: BUILDER,
      });
      // Owned by the author, titled from the idea's first line.
      expect(deps.builderSessions.createSession).toHaveBeenCalledWith(AUTHOR, {
        title: 'Tell me why I am blocked.',
      });
      expect(deps.store.repository.update).toHaveBeenCalledWith(
        { id: 'new-session' },
        expect.objectContaining({ kind: 'plan', visibility: 'shared' }),
      );
      expect(deps.dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('"builderSessionId" IS NULL'),
        ['id-OPP-0001', 'new-session', OWNER],
      );
      expect(deps.store.update).toHaveBeenCalledWith(
        'new-session',
        expect.objectContaining({ leadUserId: BUILDER }),
      );
      expect(deps.events.record).toHaveBeenCalledWith(
        expect.objectContaining({ kind: PlanEventKind.LEAD_ASSIGNED }),
      );
    });

    it('keeps the winner and archives its own session when another Owner got there first', async () => {
      const { service, deps } = build({ noSession: true, stage: 'accepted' });
      deps.dataSource.query.mockImplementation(async (sql: string) => {
        if (sql.startsWith('UPDATE "roadmap_opportunities"')) return [[], 0];
        if (sql.includes('SELECT description')) return [{ description: 'x' }];
        return [];
      });
      deps.lookup.get
        .mockResolvedValueOnce({
          id: 'id-1',
          code: 'OPP-0001',
          createdBy: AUTHOR,
          builderSessionId: null,
        })
        .mockResolvedValue({
          id: 'id-1',
          code: 'OPP-0001',
          createdBy: AUTHOR,
          builderSessionId: 'winner',
        });
      await service.lead(OWNER, 'OPP-0001', {
        action: 'assign',
        leadUserId: BUILDER,
      });
      expect(deps.store.update).toHaveBeenCalledWith(
        'new-session',
        expect.objectContaining({ archivedAt: expect.any(Date) }),
      );
      expect(deps.store.update).toHaveBeenCalledWith(
        'winner',
        expect.objectContaining({ leadUserId: BUILDER }),
      );
    });

    it('does not create a session just to hand an idea back', async () => {
      const { service, deps } = build({ noSession: true, stage: 'accepted' });
      await expect(
        service.lead(BUILDER, 'OPP-0001', { action: 'handBack' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(deps.builderSessions.createSession).not.toHaveBeenCalled();
    });
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

  it('Start planning: an Owner expands it into a plan and assigns nobody', async () => {
    const { service, deps } = build({
      stage: 'accepted',
      can: { startPlanning: true },
    });
    await service.startPlanning(OWNER, 'OPP-0001');
    expect(deps.store.update).not.toHaveBeenCalledWith(
      's-OPP-0001',
      expect.objectContaining({ leadUserId: expect.anything() }),
    );
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

  it('Start planning queues the opening turn as its last step', async () => {
    const { service, deps } = build({
      stage: 'accepted',
      can: { startPlanning: true },
    });
    const order: string[] = [];
    deps.stage.sync.mockImplementation(async () => {
      order.push('sync');
    });
    deps.broadcast.emit.mockImplementation(() => {
      order.push('emit');
    });
    deps.planTurns.queueOpeningTurn.mockImplementation(() => {
      order.push('turn');
    });
    (deps.reader.detail as jest.Mock).mockImplementation(
      async (_u: number, code: string) => ({
        code,
        title: 'Streak reminders',
        shownStage: 'accepted',
        can: { startPlanning: true },
      }),
    );
    await service.startPlanning(OWNER, 'OPP-0001');
    expect(deps.planTurns.queueOpeningTurn).toHaveBeenCalledWith(
      's-OPP-0001',
      OWNER,
      'OPP-0001',
      'Streak reminders',
    );
    expect(order).toEqual(['sync', 'emit', 'turn']);
  });

  it('Start planning pressed again queues no second opening turn', async () => {
    const { service, deps } = build({
      stage: 'planning',
      can: { startPlanning: false },
    });
    deps.store.find.mockImplementation(async (id: string) => ({
      id,
      leadUserId: null,
      plan: { planningStarted: true },
    }));
    await service.startPlanning(OWNER, 'OPP-0001');
    expect(deps.planTurns.queueOpeningTurn).not.toHaveBeenCalled();
  });

  it('Close plan with open blockers stores the reason and the blockers', async () => {
    const { service, deps } = build({
      stage: 'planning',
      can: { closePlan: true },
    });
    deps.closeReadiness.checkClose.mockImplementation(async () => ({
      reason: 'Shipping the spike to learn',
      blockers: ['Approve the technical design.'],
    }));
    await service.setPlanClosed(
      OWNER,
      'OPP-0001',
      true,
      'Shipping the spike to learn',
    );
    expect(deps.closeReadiness.checkClose).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's-OPP-0001' }),
      'Shipping the spike to learn',
    );
    expect(deps.store.patchPlan).toHaveBeenCalledWith('s-OPP-0001', {
      planClosed: expect.objectContaining({
        byUserId: OWNER,
        notReady: {
          reason: 'Shipping the spike to learn',
          blockers: ['Approve the technical design.'],
        },
      }),
    });
    expect(deps.events.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: PlanEventKind.PLAN_CLOSED,
        detail: { notReady: true, openBlockers: 1 },
      }),
    );
  });

  it('Close plan refused by the gate writes nothing', async () => {
    const { service, deps } = build({
      stage: 'planning',
      can: { closePlan: true },
    });
    deps.closeReadiness.checkClose.mockImplementation(async () => {
      throw new ConflictException('not ready');
    });
    await expect(
      service.setPlanClosed(OWNER, 'OPP-0001', true),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(deps.store.patchPlan).not.toHaveBeenCalled();
  });

  it('Reopen plan never asks the gate', async () => {
    const { service, deps } = build({
      stage: 'planning',
      can: { reopenPlan: true },
    });
    await service.setPlanClosed(OWNER, 'OPP-0001', false);
    expect(deps.closeReadiness.checkClose).not.toHaveBeenCalled();
  });

  it('Start planning dates the idea as it stands for the planning agent, and never fails on it', async () => {
    const { service, deps } = build({
      stage: 'accepted',
      can: { startPlanning: true },
    });
    await service.startPlanning(OWNER, 'OPP-0001');
    expect(deps.planHandoff.attachAtStart).toHaveBeenCalledWith(
      OWNER,
      'OPP-0001',
      's-OPP-0001',
    );

    const failing = build({ stage: 'accepted', can: { startPlanning: true } });
    failing.deps.planHandoff.attachAtStart.mockRejectedValue(new Error('db'));
    await expect(
      failing.service.startPlanning(OWNER, 'OPP-0001'),
    ).resolves.toBeDefined();
    expect(failing.deps.events.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: PlanEventKind.PLANNING_STARTED }),
    );
  });

  it('Start planning on a submitted idea accepts it', async () => {
    const { service, deps } = build({
      stage: 'submitted',
      can: { startPlanning: true },
    });
    await service.startPlanning(OWNER, 'OPP-0001');
    expect(deps.dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining(`"reviewState" = 'accepted'`),
      ['id-OPP-0001', OWNER],
    );
    expect(deps.events.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: PlanEventKind.REVIEWED,
        detail: { decision: 'accept', via: 'start_planning' },
      }),
    );
    // The accept is news to the author, voters and watchers (idea-to-plan audit rec 8).
    expect(deps.ideaNotices.planningStarted).toHaveBeenCalledWith({
      actorUserId: OWNER,
      itemId: 'id-OPP-0001',
      code: 'OPP-0001',
      sessionId: 's-OPP-0001',
      acceptedNow: true,
    });
  });

  it('a failed notice never fails Start planning or Close plan', async () => {
    const { service, deps } = build({
      stage: 'planning',
      can: { startPlanning: true, closePlan: true },
    });
    deps.ideaNotices.planningStarted.mockRejectedValueOnce(new Error('down'));
    deps.ideaNotices.planClosed.mockRejectedValueOnce(new Error('down'));
    await expect(
      service.setPlanClosed(OWNER, 'OPP-0001', true),
    ).resolves.toBeDefined();
    expect(deps.ideaNotices.planClosed).toHaveBeenCalledTimes(1);
  });

  it('closes and reopens the plan for an Owner only, with an event each way', async () => {
    const { service, deps } = build({
      stage: 'planning',
      can: { closePlan: true, reopenPlan: true },
    });
    await service.setPlanClosed(OWNER, 'OPP-0001', true);
    expect(deps.store.patchPlan).toHaveBeenCalledWith(
      's-OPP-0001',
      expect.objectContaining({
        planClosed: expect.objectContaining({ byUserId: OWNER }),
      }),
    );
    await service.setPlanClosed(OWNER, 'OPP-0001', false);
    expect(deps.store.patchPlan).toHaveBeenCalledWith('s-OPP-0001', {
      planClosed: null,
    });
    // Closing tells followers; reopening tells nobody.
    expect(deps.ideaNotices.planClosed).toHaveBeenCalledTimes(1);
    expect(deps.events.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: PlanEventKind.PLAN_CLOSED }),
    );
    expect(deps.events.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: PlanEventKind.PLAN_REOPENED }),
    );

    const refused = build({
      stage: 'planning',
      can: { closePlan: false },
    });
    await expect(
      refused.service.setPlanClosed(AUTHOR, 'OPP-0001', true),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('opens the conversation on an older idea with none, for anyone who can comment', async () => {
    const { service, deps } = build({
      noSession: true,
      stage: 'accepted',
      can: { comment: true },
    });
    await service.openConversation(AUTHOR, 'OPP-0001');
    expect(deps.builderSessions.createSession).toHaveBeenCalled();
    expect(deps.events.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: PlanEventKind.FILED,
        detail: { by: 'conversation' },
      }),
    );
    // It assigns nobody and starts nothing.
    expect(deps.store.update).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ leadUserId: expect.anything() }),
    );

    const closed = build({ noSession: true, can: { comment: false } });
    await expect(
      closed.service.openConversation(AUTHOR, 'OPP-0001'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
