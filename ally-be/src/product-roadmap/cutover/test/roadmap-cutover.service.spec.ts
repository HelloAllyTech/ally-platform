import { ConflictException, ForbiddenException } from '@nestjs/common';
import { BuilderSession } from 'src/builder/entity/builder-session.entity';
import { RoadmapCutoverService } from '../roadmap-cutover.service';

/**
 * An in-memory stand-in for the tables the cutover touches, answering the service's SQL by
 * what each statement is for. Enough to show the order of writes and what a second run does.
 */
function world(opts: { role?: string; flag?: boolean; goals?: string[] } = {}) {
  const state = {
    flag: opts.flag ?? false,
    seq: 900,
    drafts: [
      {
        id: 'aaaaaaaa-1111-4111-8111-111111111111',
        ownerUserId: 7,
        rawText: 'Let counsellors pin a note\nmore detail',
        captureMode: 'voice',
        createdAt: new Date('2026-11-01T00:00:00Z'),
        updatedAt: new Date('2026-11-02T00:00:00Z'),
        migratedAt: null as Date | null,
        migratedToId: null as string | null,
        deletedAt: null as Date | null,
      },
      {
        id: 'bbbbbbbb-2222-4222-8222-222222222222',
        ownerUserId: 8,
        rawText: 'Deleted by its author',
        captureMode: 'typed',
        createdAt: new Date('2026-11-01T00:00:00Z'),
        updatedAt: new Date('2026-11-01T00:00:00Z'),
        migratedAt: null as Date | null,
        migratedToId: null as string | null,
        deletedAt: new Date('2026-11-03T00:00:00Z') as Date | null,
      },
    ],
    sessions: [
      {
        id: 's-live',
        kind: 'build',
        visibility: 'shared',
        archivedAt: null,
        deletedAt: null,
        status: 'BUILDING',
        createdBy: 3,
        title: 'Faster session start',
        leadUserId: null as number | null,
        plan: null as Record<string, unknown> | null,
        slug: 'faster-session-start',
      },
      {
        id: 's-done',
        kind: 'build',
        visibility: 'shared',
        archivedAt: null,
        deletedAt: null,
        status: 'COMPLETED',
        createdBy: 3,
        title: 'Shipped long ago',
        leadUserId: null as number | null,
        plan: null as Record<string, unknown> | null,
        slug: 'shipped-long-ago',
      },
      {
        id: 's-archived',
        kind: 'build',
        visibility: 'shared',
        archivedAt: new Date(),
        deletedAt: null,
        status: 'INTERVIEWING',
        createdBy: 4,
        title: 'Parked',
        leadUserId: null as number | null,
        plan: null as Record<string, unknown> | null,
        slug: 'parked',
      },
      {
        id: 's-linked',
        kind: 'build',
        visibility: 'shared',
        archivedAt: null,
        deletedAt: null,
        status: 'INTERVIEWING',
        createdBy: 4,
        title: 'Opened from an idea',
        leadUserId: null as number | null,
        plan: null as Record<string, unknown> | null,
        slug: 'opened-from-an-idea',
      },
    ],
    opportunities: [
      { id: 'o-1', builderSessionId: 's-linked', reviewState: 'accepted' },
      { id: 'o-2', builderSessionId: null, reviewState: null },
      { id: 'o-3', builderSessionId: null, reviewState: null },
    ] as {
      id: string;
      builderSessionId: string | null;
      reviewState: string | null;
      source?: string;
    }[],
    goals: opts.goals ?? ['Engagement', 'Reliability & Trust'],
    log: [] as Record<string, unknown>[],
    events: [] as Record<string, unknown>[],
    order: [] as string[],
    users: new Map<number, string>([
      [3, 'Ravi'],
      [7, 'Meera'],
      [8, 'Kiran'],
      [1, 'Asha'],
    ]),
  };

  const active = ['INTERVIEWING', 'PRD_READY', 'BUILDING', 'WAITING_FOR_INPUT'];
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    if (sql.includes('pg_advisory_xact_lock')) return [];
    if (sql.includes(`FROM "roadmap_idea_drafts"`)) {
      return state.drafts.filter((d) => !d.deletedAt && !d.migratedAt);
    }
    if (sql.includes(`'migratedFromDraftId' = $1`)) {
      return state.sessions
        .filter((s) => s.plan?.migratedFromDraftId === params[0])
        .map((s) => ({ id: s.id, code: s.plan?.code ?? null }));
    }
    if (sql.includes('roadmap_opportunity_code_seq')) {
      return [{ code: `OPP-${++state.seq}` }];
    }
    if (sql.includes('SET "plan" = COALESCE')) {
      const s = state.sessions.find((x) => x.id === params[0])!;
      s.plan = {
        ...(s.plan ?? {}),
        code: params[1],
        draftText: (s.plan?.draftText as string) ?? params[2],
        draftVersion: (s.plan?.draftVersion as number) ?? 1,
      };
      return [];
    }
    if (sql.includes('WHERE slug = $1')) return [];
    if (sql.includes(`"defaultBudgetUsd" FROM`))
      return [{ defaultBudgetUsd: null }];
    if (sql.includes(`UPDATE "roadmap_idea_drafts"`)) {
      const d = state.drafts.find((x) => x.id === params[0])!;
      if (!d.migratedAt) {
        d.migratedAt = new Date();
        d.migratedToId = params[1];
      }
      return [];
    }
    if (sql.includes(`FROM "builder_sessions" s`)) {
      return state.sessions.filter(
        (s) =>
          s.kind === 'build' &&
          s.visibility === 'shared' &&
          !s.archivedAt &&
          !s.deletedAt &&
          active.includes(s.status) &&
          !state.opportunities.some((o) => o.builderSessionId === s.id),
      );
    }
    if (sql.includes('roadmap_product_goals')) {
      return state.goals.slice(0, 1).map((name) => ({ name }));
    }
    if (sql.includes('builder_messages')) return [];
    if (sql.includes(`SET "leadUserId"`)) {
      const s = state.sessions.find((x) => x.id === params[0])!;
      s.leadUserId = s.leadUserId ?? s.createdBy;
      return [];
    }
    if (sql.includes('WITH accepted AS')) {
      const pending = state.opportunities.filter((o) => o.reviewState === null);
      pending.forEach((o) => (o.reviewState = 'accepted'));
      state.order.push('reviews');
      return [{ n: pending.length }];
    }
    if (sql.includes(`UPDATE "builder_settings"`)) {
      state.flag = true;
      state.order.push('flag');
      return [{ id: 'settings' }];
    }
    if (sql.includes(`INSERT INTO "roadmap_cutover_log"`)) {
      state.log.push({
        actorUserId: params[0],
        counts: JSON.parse(params[1]),
        builders: JSON.parse(params[2]),
        owners: JSON.parse(params[3]),
        flagWasOn: params[4],
      });
      state.order.push('log');
      return [{ at: new Date('2026-11-17T10:00:00Z') }];
    }
    if (sql.includes(`count(*)::int AS n FROM "roadmap_opportunities"`)) {
      return [
        { n: state.opportunities.filter((o) => o.reviewState === null).length },
      ];
    }
    if (sql.includes(`FROM "roadmap_cutover_log"`)) {
      const last = state.log[state.log.length - 1];
      return last
        ? [
            {
              at: new Date('2026-11-17T10:00:00Z'),
              actorUserId: last.actorUserId,
              counts: last.counts,
              actorName: 'Asha',
            },
          ]
        : [];
    }
    if (sql.includes(`FROM "users"`)) {
      return (params[0] as number[])
        .filter((id) => state.users.has(id))
        .map((id) => ({ id, name: state.users.get(id) }));
    }
    throw new Error(`Unexpected SQL in test: ${sql}`);
  });

  let nextSession = 0;
  const sessionRepository = {
    create: (row: Partial<BuilderSession>) => row,
    save: jest.fn(async (row: any) => {
      const saved = { ...row, id: `plan-${++nextSession}` };
      state.sessions.push({
        ...saved,
        status: 'INTERVIEWING',
        archivedAt: null,
        deletedAt: null,
        leadUserId: null,
      });
      state.order.push('draft');
      return saved;
    }),
  };
  const manager = {
    query,
    getRepository: (entity: unknown) => {
      if (entity !== BuilderSession) throw new Error('unexpected repository');
      return sessionRepository;
    },
  };
  const dataSource = {
    manager,
    query,
    transaction: jest.fn(async (cb: (m: unknown) => unknown) => cb(manager)),
  };
  const roles = {
    roleOf: jest.fn(async () => opts.role ?? 'owner'),
    previewPromotions: jest.fn(async () => [
      { userId: 1, name: 'Asha', role: 'owner' },
      { userId: 3, name: 'Ravi', role: 'builder' },
      { userId: 5, name: 'Dev', role: 'builder' },
    ]),
    grantsOf: jest.fn(async (id: number) => ({
      roadmap: id !== 5,
      builder: id !== 1,
      manage: id === 1,
      restricted: false,
    })),
  };
  const settings = {
    getRoadmapV2: jest.fn(async () => ({ enabled: state.flag })),
  };
  const events = {
    record: jest.fn(async (input: Record<string, unknown>, m: unknown) => {
      expect(m).toBe(manager);
      state.events.push(input);
      return input;
    }),
  };
  let nextOpp = 0;
  const opportunities = {
    fileMigratedBuilderSession: jest.fn(async (m: unknown, input: any) => {
      expect(m).toBe(manager);
      const id = `o-new-${++nextOpp}`;
      state.opportunities.push({
        id,
        builderSessionId: input.sessionId,
        reviewState: 'accepted',
        source: 'migrated_builder_session',
      });
      state.order.push('filed');
      return { id, code: `OPP-${++state.seq}` };
    }),
    afterMigratedFiling: jest.fn(async () => undefined),
  };
  const config = { builder: { defaultBudgetUsd: 25 } };
  const service = new RoadmapCutoverService(
    dataSource as never,
    roles as never,
    settings as never,
    events as never,
    opportunities as never,
    config as never,
  );
  return {
    service,
    state,
    roles,
    opportunities,
    dataSource,
    sessionRepository,
  };
}

const CONFIRMED = { confirmedBuilderIds: [3, 5], confirmedOwnerIds: [1] };

describe('RoadmapCutoverService', () => {
  describe('preview', () => {
    it('lists who becomes Builder and Owner, by name and id, and what will move', async () => {
      const { service } = world();
      const preview = await service.preview(1);
      expect(preview.roadmapV2Enabled).toBe(false);
      expect(preview.owners).toEqual([{ userId: 1, name: 'Asha' }]);
      expect(preview.builders).toEqual([
        { userId: 3, name: 'Ravi' },
        { userId: 5, name: 'Dev' },
      ]);
      expect(preview.withoutRoadmapAccess).toEqual([
        { userId: 5, name: 'Dev' },
      ]);
      expect(preview.drafts).toEqual({
        total: 1,
        items: [
          {
            id: 'aaaaaaaa-1111-4111-8111-111111111111',
            authorUserId: 7,
            authorName: 'Meera',
            title: 'Let counsellors pin a note',
          },
        ],
      });
      // Only the live, unarchived session with no idea: not the terminal, archived or linked ones.
      expect(preview.sessions.items.map((s) => s.sessionId)).toEqual([
        's-live',
      ]);
      expect(preview.sessions.items[0].creatorName).toBe('Ravi');
      expect(preview.reviewBackfill).toEqual({ total: 2 });
      expect(preview.goal).toBe('Engagement');
      expect(preview.lastRun).toBeNull();
      expect(JSON.stringify(preview)).not.toMatch(/@/);
    });

    it('is for Owners only', async () => {
      await expect(
        world({ role: 'builder' }).service.preview(3),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('run', () => {
    it('moves drafts and live sessions, accepts unreviewed ideas, and switches the flag on last', async () => {
      const { service, state, opportunities } = world();
      const result = await service.run(1, CONFIRMED);

      expect(result.counts).toEqual({
        draftsMoved: 1,
        sessionsFiled: 1,
        reviewsAccepted: 2,
        builders: 2,
        owners: 1,
      });
      expect(result.roadmapV2Enabled).toBe(true);
      expect(state.flag).toBe(true);
      expect(state.order).toEqual(['draft', 'filed', 'reviews', 'flag', 'log']);

      // The draft is a private plan draft for its author, and its source row is labelled, not deleted.
      const plan = state.sessions.find((s) => s.id === 'plan-1')!;
      expect(plan).toMatchObject({
        kind: 'plan',
        visibility: 'private',
        planStage: 'idea',
        createdBy: 7,
        title: 'Let counsellors pin a note',
        budgetUsd: '25',
        plan: {
          code: result.drafts[0].code,
          draftText: 'Let counsellors pin a note\nmore detail',
          draftVersion: 1,
          parked: true,
          captureMode: 'voice',
          migratedFromDraftId: 'aaaaaaaa-1111-4111-8111-111111111111',
          lastActiveAt: '2026-11-02T00:00:00.000Z',
        },
      });
      const draft = state.drafts[0];
      expect(draft.migratedAt).toBeInstanceOf(Date);
      expect(draft.migratedToId).toBe('plan-1');
      expect(draft.deletedAt).toBeNull();
      expect(state.drafts[1].migratedAt).toBeNull();

      // The live session gets an idea and its creator as lead; the others are untouched.
      expect(opportunities.fileMigratedBuilderSession).toHaveBeenCalledTimes(1);
      expect(opportunities.fileMigratedBuilderSession.mock.calls[0][1]).toEqual(
        {
          sessionId: 's-live',
          description: 'Faster session start',
          productGoal: 'Engagement',
          creatorUserId: 3,
          actorUserId: 1,
        },
      );
      expect(state.sessions.find((s) => s.id === 's-live')!.leadUserId).toBe(3);
      for (const id of ['s-done', 's-archived', 's-linked']) {
        expect(state.sessions.find((s) => s.id === id)!.leadUserId).toBeNull();
      }
      expect(result.filed).toEqual([
        { sessionId: 's-live', code: expect.stringMatching(/^OPP-/) },
      ]);
      expect(state.events.map((e) => e.kind)).toEqual(['parked', 'filed']);

      expect(state.log).toEqual([
        {
          actorUserId: 1,
          counts: result.counts,
          builders: [3, 5],
          owners: [1],
          flagWasOn: false,
        },
      ]);
      expect(opportunities.afterMigratedFiling).toHaveBeenCalledWith(
        ['o-new-1'],
        1,
      );
    });

    it('is idempotent: a second run moves nothing and only re-asserts the flag', async () => {
      const { service, state, opportunities, sessionRepository } = world();
      await service.run(1, CONFIRMED);
      const second = await service.run(1, CONFIRMED);
      expect(second.counts).toEqual({
        draftsMoved: 0,
        sessionsFiled: 0,
        reviewsAccepted: 0,
        builders: 2,
        owners: 1,
      });
      expect(sessionRepository.save).toHaveBeenCalledTimes(1);
      expect(opportunities.fileMigratedBuilderSession).toHaveBeenCalledTimes(1);
      expect(state.flag).toBe(true);
      expect(state.log).toHaveLength(2);
      expect(state.log[1].flagWasOn).toBe(true);
    });

    it('refuses with 409 when the confirmed lists are not today’s, and writes nothing', async () => {
      const { service, state, dataSource } = world();
      const attempts = [
        { confirmedBuilderIds: [3], confirmedOwnerIds: [1] },
        { confirmedBuilderIds: [3, 5], confirmedOwnerIds: [] },
        { confirmedBuilderIds: [3, 5, 9], confirmedOwnerIds: [1] },
      ];
      for (const attempt of attempts) {
        const error = await service.run(1, attempt).catch((e) => e);
        expect(error).toBeInstanceOf(ConflictException);
        expect(error.getResponse()).toMatchObject({ code: 'roles_changed' });
      }
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(state.flag).toBe(false);
    });

    it('accepts the confirmed ids in any order', async () => {
      const { service, state } = world();
      await service.run(1, {
        confirmedBuilderIds: [5, 3, 3],
        confirmedOwnerIds: [1],
      });
      expect(state.flag).toBe(true);
    });

    it('is for Owners only', async () => {
      const { service, dataSource } = world({ role: 'builder' });
      await expect(service.run(3, CONFIRMED)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('reuses a plan the old planning migrator made from a draft, giving it a code', async () => {
      const { service, state, sessionRepository } = world();
      state.sessions.push({
        id: 'old-plan',
        kind: 'plan',
        visibility: 'private',
        archivedAt: null,
        deletedAt: null,
        status: 'INTERVIEWING',
        createdBy: 7,
        title: 'Let counsellors pin a note',
        leadUserId: null,
        plan: {
          parked: true,
          migratedFromDraftId: 'aaaaaaaa-1111-4111-8111-111111111111',
        },
        slug: 'let-counsellors-pin-a-note',
      });
      const result = await service.run(1, CONFIRMED);
      expect(sessionRepository.save).not.toHaveBeenCalled();
      expect(
        state.sessions.find((s) => s.id === 'old-plan')!.plan,
      ).toMatchObject({
        code: result.drafts[0].code,
        draftVersion: 1,
      });
      expect(state.drafts[0].migratedToId).toBe('old-plan');
    });

    it('stops before the flag when a session cannot be filed (no product goal)', async () => {
      const { service, state } = world({ goals: [] });
      const error = await service.run(1, CONFIRMED).catch((e) => e);
      expect(error.getResponse()).toMatchObject({ code: 'no_goal' });
      expect(state.flag).toBe(false);
      expect(state.log).toHaveLength(0);
    });
  });
});
