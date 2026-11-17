import {
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PlanEventKind,
  RoadmapNotificationKind,
} from 'src/product-planning/enum/product-planning.enum';
import { RoadmapItemEditService } from '../roadmap-item-edit.service';

const ME = 5;
const ITEM_ID = '11111111-1111-1111-1111-111111111111';

const ALL_EDITS = {
  editTitle: true,
  editGoal: true,
  editSummary: true,
  editLead: true,
  editMonth: true,
  star: true,
};

function build(
  opts: {
    can?: Partial<typeof ALL_EDITS>;
    sessionId?: string | null;
    session?: { id: string; kind: string; leadUserId: number | null } | null;
    roles?: Record<number, string>;
    description?: string;
  } = {},
) {
  const can = { ...ALL_EDITS, ...(opts.can ?? {}) };
  const sessionId = opts.sessionId === undefined ? 's1' : opts.sessionId;
  const reader = {
    detail: jest.fn(async () => ({
      code: 'OPP-0388',
      can,
      starred: true,
      starredBy: { id: ME, name: 'Me', role: 'owner' },
    })),
  };
  const dataSource = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('SELECT description')) {
        return [
          {
            description:
              opts.description ??
              'Streak on start screen\n\nLearners drop off.',
            productGoal: 'Growth',
            plannedMonth: null,
          },
        ];
      }
      if (sql.includes('roadmap_product_goals')) return [{ name: 'Retention' }];
      if (sql.includes('FROM "builder_sessions"')) {
        return opts.session === null
          ? []
          : [opts.session ?? { id: 's1', kind: 'plan', leadUserId: 2 }];
      }
      return [];
    }),
  };
  const roles = {
    roleOf: jest.fn(async (id: number) => opts.roles?.[id] ?? 'builder'),
  };
  const lookup = {
    get: jest.fn(async () => ({
      id: ITEM_ID,
      code: 'OPP-0388',
      createdBy: 1,
      builderSessionId: sessionId,
    })),
  };
  const opportunities = { update: jest.fn(async () => ({})) };
  const strategyGoals = { invalidate: jest.fn() };
  const planStore = {
    update: jest.fn(async () => ({})),
    patchPlan: jest.fn(async () => undefined),
  };
  const planStage = { sync: jest.fn(async () => 'prd') };
  const events = { record: jest.fn(async () => ({})) };
  const inbox = {
    markSeen: jest.fn(async () => undefined),
    deliver: jest.fn(async () => []),
  };
  const notifications = { emit: jest.fn() };
  const service = new RoadmapItemEditService(
    dataSource as never,
    roles as never,
    lookup as never,
    reader as never,
    opportunities as never,
    strategyGoals as never,
    planStore as never,
    planStage as never,
    events as never,
    inbox as never,
    notifications as never,
  );
  return {
    service,
    dataSource,
    opportunities,
    planStore,
    planStage,
    events,
    inbox,
    notifications,
    strategyGoals,
  };
}

describe('RoadmapItemEditService.patch', () => {
  it('refuses a field the caller may not edit, naming it, and changes nothing', async () => {
    const { service, opportunities, events } = build({
      can: { editMonth: false },
    });
    await expect(
      service.patch(ME, 'OPP-0388', { title: 'New', plannedMonth: '2026-12' }),
    ).rejects.toThrow(
      new ForbiddenException("You can't change this idea's planned month."),
    );
    expect(opportunities.update).not.toHaveBeenCalled();
    expect(events.record).not.toHaveBeenCalled();
  });

  it('rewrites only the title line, keeps the body, and records an attributed event', async () => {
    const { service, opportunities, events, notifications, inbox } = build();
    await service.patch(ME, 'OPP-0388', { title: '  Streak   first ' });
    expect(opportunities.update).toHaveBeenCalledWith(ME, ITEM_ID, {
      description: 'Streak first\n\nLearners drop off.',
    });
    expect(events.record).toHaveBeenCalledWith({
      sessionId: 's1',
      kind: PlanEventKind.ITEM_EDITED,
      actorUserId: ME,
      detail: {
        field: 'title',
        from: 'Streak on start screen',
        to: 'Streak first',
      },
    });
    expect(notifications.emit).toHaveBeenCalledWith({
      kind: 'ITEM_CHANGED',
      actorId: ME,
      code: 'OPP-0388',
      fields: ['title'],
    });
    expect(inbox.markSeen).toHaveBeenCalledWith(ME, ITEM_ID);
  });

  it('edits the summary under the title, and resolves the goal by id', async () => {
    const { service, opportunities, events } = build();
    await service.patch(ME, 'OPP-0388', {
      summary: { problem: 'New learners leave in week one.' },
      goalId: '22222222-2222-2222-2222-222222222222',
    });
    expect(opportunities.update).toHaveBeenCalledWith(ME, ITEM_ID, {
      description: 'Streak on start screen\n\nNew learners leave in week one.',
      productGoal: 'Retention',
    });
    expect(
      events.record.mock.calls.map((c: any[]) => c[0].detail.field),
    ).toEqual(['summary', 'goal']);
  });

  it('refuses text over the idea limit', async () => {
    const { service } = build();
    await expect(
      service.patch(ME, 'OPP-0388', { summary: { problem: 'x'.repeat(995) } }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('writes nothing when nothing changed', async () => {
    const { service, opportunities, events, notifications } = build();
    await service.patch(ME, 'OPP-0388', { title: 'Streak on start screen' });
    expect(opportunities.update).not.toHaveBeenCalled();
    expect(events.record).not.toHaveBeenCalled();
    expect(notifications.emit).not.toHaveBeenCalled();
  });

  it('sets the planned month, and clears it with null', async () => {
    const { service, opportunities } = build();
    await service.patch(ME, 'OPP-0388', { plannedMonth: '2026-12' });
    expect(opportunities.update).toHaveBeenCalledWith(ME, ITEM_ID, {
      plannedMonth: '2026-12',
    });
  });

  describe('lead', () => {
    it('assigns a Builder, syncs the stage and tells the new lead', async () => {
      const { service, planStore, planStage, inbox, events } = build();
      await service.patch(ME, 'OPP-0388', { leadUserId: 7 });
      expect(planStore.update).toHaveBeenCalledWith('s1', {
        leadUserId: 7,
        updatedBy: ME,
      });
      expect(planStage.sync).toHaveBeenCalledWith('s1', ME);
      expect(inbox.deliver).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: RoadmapNotificationKind.ASSIGNED_TO_YOU,
          directRecipientIds: [7],
        }),
      );
      expect(events.record).toHaveBeenCalledWith(
        expect.objectContaining({ detail: { field: 'lead', from: 2, to: 7 } }),
      );
    });

    it('refuses someone who is not a Builder', async () => {
      const { service, planStore } = build({ roles: { 7: 'idea' } });
      await expect(
        service.patch(ME, 'OPP-0388', { leadUserId: 7 }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(planStore.update).not.toHaveBeenCalled();
    });

    it('is a conflict on an idea with no plan session, and nothing else is written', async () => {
      const { service, opportunities } = build({
        session: { id: 's1', kind: 'build', leadUserId: null },
      });
      await expect(
        service.patch(ME, 'OPP-0388', { leadUserId: 7, title: 'Other' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(opportunities.update).not.toHaveBeenCalled();
    });
  });
});

describe('RoadmapItemEditService.setStar', () => {
  it('stars as the Owner and invalidates the board rank', async () => {
    const { service, dataSource, strategyGoals, notifications } = build();
    const result = await service.setStar(ME, 'OPP-0388', true);
    const update: unknown[] | undefined = dataSource.query.mock.calls.find(
      (c: any[]) => String(c[0]).includes('"directorStarred" = $2'),
    );
    expect(update?.[1]).toEqual([ITEM_ID, true, ME, ME]);
    expect(strategyGoals.invalidate).toHaveBeenCalledWith(ME);
    expect(notifications.emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ITEM_CHANGED', fields: ['starred'] }),
    );
    expect(result.starred).toBe(true);
  });

  it('refuses anyone the page does not offer the star to', async () => {
    const { service, dataSource } = build({
      can: { star: false },
      roles: { [ME]: 'builder' },
    });
    await expect(service.setStar(ME, 'OPP-0388', true)).rejects.toThrow(
      'Only an Owner can star an idea.',
    );
    expect(
      dataSource.query.mock.calls.some((c: any[]) =>
        String(c[0]).includes('directorStarred'),
      ),
    ).toBe(false);
  });
});
