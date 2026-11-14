import { BadRequestException } from '@nestjs/common';
import { BuilderSessionVisibility } from 'src/builder/enum/builder.enum';
import { PlanStage } from 'src/product-planning/enum/product-planning.enum';
import { IDEA_WRAP_UP_REPLY, PlanIdeaService } from '../plan-idea.service';

const DAY = 24 * 60 * 60 * 1000;

function build(over: Record<string, any> = {}) {
  const plan: any = {
    id: 'p1',
    title: 'Idea',
    createdBy: 7,
    visibility: BuilderSessionVisibility.PRIVATE,
    archivedAt: null,
    createdAt: new Date('2026-01-01'),
    plan: {},
    ...over.plan,
  };
  const deps: Record<string, any> = {
    store: {
      get: jest.fn(async () => plan),
      find: jest.fn(async () => plan),
      patchPlan: jest.fn(),
      update: jest.fn(),
      repository: {
        update: jest.fn(),
        delete: jest.fn(),
        createQueryBuilder: jest.fn(() => {
          const qb: any = {};
          for (const m of ['addSelect', 'where', 'andWhere', 'orderBy', 'take'])
            qb[m] = () => qb;
          qb.getMany = async () => over.drafts ?? [];
          return qb;
        }),
      },
    },
    view: { render: jest.fn(async (p: any) => ({ id: p.id })) },
    stage: { sync: jest.fn() },
    builderSessions: {
      createSession: jest.fn(async () => ({ id: 'new' })),
      attachHandoffContext: jest.fn(),
    },
    messages: {
      appendMessage: jest.fn(),
      listBySession: jest.fn(async () => [
        { role: 'user', content: 'my idea', metadata: { planStage: 'idea' } },
      ]),
    },
    copilot: {
      takeTurn: jest.fn(async () => ({
        reply: 'Who does this help?',
        gates: [{ id: 'who_it_affects', met: false, note: '' }],
        draft: null,
        readinessToken: null,
        brief: { x: 1 },
      })),
    },
    opportunityService: { create: jest.fn(async () => ({ id: 'opp1' })) },
    roadmapBuilder: {
      handoffTextForOpportunity: jest.fn(async () => 'handoff'),
    },
    access: {
      assertIdeas: jest.fn(),
      canRead: jest.fn(async () => true),
      canEdit: jest.fn(async () => true),
    },
    settings: {
      assertEnabled: jest.fn(),
      get: jest.fn(async () => ({ enabled: true })),
    },
    spend: {
      checkCeiling: jest.fn(async () => ({ state: 'ok' })),
      record: jest.fn(),
    },
    events: { record: jest.fn() },
    notifications: { notify: jest.fn() },
    dataSource: { query: jest.fn(async () => [{ id: 'p1' }]) },
    opportunities: { update: jest.fn() },
    drafts: { find: jest.fn(async () => []), softDelete: jest.fn() },
    ...over.deps,
  };
  const service = new PlanIdeaService(
    deps.store,
    deps.view,
    deps.stage,
    deps.builderSessions,
    deps.messages,
    deps.copilot,
    deps.opportunityService,
    deps.roadmapBuilder,
    deps.access,
    deps.settings,
    deps.spend,
    deps.events,
    deps.notifications,
    deps.dataSource,
    deps.opportunities,
    deps.drafts,
  );
  return { service, deps, plan };
}

describe('PlanIdeaService', () => {
  it('parks an idea as a private plan session with no AI', async () => {
    const { service, deps } = build();
    await service.start(7, {
      text: 'Learners drop off after a missed week',
      park: true,
    });
    expect(deps.access.assertIdeas).toHaveBeenCalledWith(7);
    expect(deps.store.repository.update).toHaveBeenCalledWith(
      { id: 'new' },
      expect.objectContaining({
        kind: 'plan',
        visibility: 'private',
        planStage: PlanStage.IDEA,
      }),
    );
    expect(deps.copilot.takeTurn).not.toHaveBeenCalled();
    expect(deps.events.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'parked' }),
    );
  });

  it('runs a copilot turn on the session and holds its verdict server-side', async () => {
    const { service, deps } = build();
    await service.turn('p1', 7, 'It is about learners');
    expect(deps.copilot.takeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'admin', content: 'my idea' }],
      }),
      7,
    );
    expect(deps.store.patchPlan).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        idea: expect.objectContaining({
          gates: [{ id: 'who_it_affects', met: false, note: '' }],
        }),
      }),
    );
  });

  it('wraps up instead of calling the model once the idea share is spent', async () => {
    const { service, deps } = build({
      deps: {
        spend: {
          checkCeiling: jest.fn(async () => ({ state: 'wrap_up' })),
          record: jest.fn(),
        },
      },
    });
    await service.turn('p1', 7, 'more');
    expect(deps.copilot.takeTurn).not.toHaveBeenCalled();
    expect(deps.messages.appendMessage).toHaveBeenLastCalledWith(
      'p1',
      expect.objectContaining({ content: IDEA_WRAP_UP_REPLY }),
    );
  });

  it('refuses to file until every criterion is met, naming what is missing', async () => {
    const { service } = build({
      plan: {
        plan: { idea: { gates: [{ id: 'outcome', met: false }], draft: null } },
      },
    });
    await expect(service.file('p1', 7)).rejects.toThrow(/outcome/);
  });

  it('files once: creates the opportunity, links it, shares the session and hands off', async () => {
    const { service, deps } = build({
      plan: {
        plan: {
          idea: {
            gates: [{ id: 'a', met: true }],
            draft: {
              description: 'Help learners return',
              productGoal: 'Engagement',
              effort: 'm',
            },
            readinessToken: 'tok',
            brief: { b: 1 },
          },
        },
      },
    });
    await service.file('p1', 7);
    expect(deps.opportunityService.create).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        description: 'Help learners return',
        readinessToken: 'tok',
        productGoal: 'Engagement',
      }),
      { canManage: false, enforceReadiness: true },
    );
    expect(deps.opportunities.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'opp1' }),
      { builderSessionId: 'p1' },
    );
    expect(deps.store.update).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ visibility: 'shared' }),
    );
    expect(deps.builderSessions.attachHandoffContext).toHaveBeenCalledWith(
      'p1',
      'handoff',
    );
    expect(deps.events.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'filed' }),
    );
  });

  it('a second click while filing is in flight files nothing', async () => {
    const { service, deps } = build({
      plan: {
        plan: {
          idea: {
            gates: [{ id: 'a', met: true }],
            draft: { description: 'x', productGoal: 'g', effort: null },
            readinessToken: 'tok',
          },
        },
      },
      deps: { dataSource: { query: jest.fn(async () => []) } },
    });
    await service.file('p1', 7);
    expect(deps.opportunityService.create).not.toHaveBeenCalled();
  });

  it('archives a quiet draft at 30 days and warns 7 days before', async () => {
    const now = new Date('2026-03-01T00:00:00Z');
    const quiet = {
      id: 'q',
      title: 'Quiet',
      createdBy: 7,
      createdAt: now,
      archivedAt: null,
      plan: { lastActiveAt: new Date(now.getTime() - 31 * DAY).toISOString() },
    };
    const soon = {
      id: 's',
      title: 'Soon',
      createdBy: 7,
      createdAt: now,
      archivedAt: null,
      plan: { lastActiveAt: new Date(now.getTime() - 24 * DAY).toISOString() },
    };
    const { service, deps } = build({ drafts: [quiet, soon] });
    const result = await service.sweepExpiry(now);
    expect(result.archived).toBe(1);
    expect(deps.store.update).toHaveBeenCalledWith('q', { archivedAt: now });
    expect(deps.notifications.notify).toHaveBeenCalledWith(
      7,
      's',
      'archive_soon',
      expect.any(String),
    );
  });

  it('purges an archived draft 60 days later, re-checking inside the DELETE', async () => {
    const now = new Date('2026-06-01T00:00:00Z');
    const old = {
      id: 'o',
      title: 'Old',
      createdBy: 7,
      createdAt: now,
      archivedAt: new Date(now.getTime() - 61 * DAY),
      plan: {},
    };
    const { service, deps } = build({
      drafts: [old],
      deps: { dataSource: { query: jest.fn(async () => [[], 1]) } },
    });
    const result = await service.sweepExpiry(now);
    expect(result.purged).toBe(1);
    expect(deps.dataSource.query.mock.calls[0][0]).toMatch(
      /DELETE FROM "builder_sessions"[\s\S]*"archivedAt" <= \$2/,
    );
  });

  it('does nothing while planning is switched off', async () => {
    const { service, deps } = build({
      deps: {
        settings: {
          get: jest.fn(async () => ({ enabled: false })),
          assertEnabled: jest.fn(),
        },
      },
    });
    expect(await service.sweepExpiry()).toEqual({ archived: 0, purged: 0 });
    expect(await service.migrateIdeaDrafts()).toBe(0);
    expect(deps.store.repository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('rejects an empty idea', async () => {
    const { service } = build();
    await expect(service.start(7, { text: '   ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
