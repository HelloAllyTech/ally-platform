import { ConflictException, ForbiddenException } from '@nestjs/common';
import { BuilderSessionVisibility } from 'src/builder/enum/builder.enum';
import { PlanLeadService } from '../plan-lead.service';

const DAY = 24 * 60 * 60 * 1000;

function build(
  planOver: Record<string, any> = {},
  depsOver: Record<string, any> = {},
) {
  let plan: any = {
    id: 'p1',
    title: 'Plan',
    createdBy: 7,
    leadUserId: null,
    visibility: BuilderSessionVisibility.SHARED,
    status: 'INTERVIEWING',
    updatedAt: new Date(),
    plan: { opportunityId: 'opp1' },
    ...planOver,
  };
  const deps: Record<string, any> = {
    store: {
      find: jest.fn(async () => plan),
      get: jest.fn(async () => plan),
      patchPlan: jest.fn(async (_id: string, patch: any) => {
        plan = { ...plan, plan: { ...plan.plan, ...patch } };
      }),
      repository: {
        update: jest.fn(async () => ({ affected: 1 })),
        createQueryBuilder: jest.fn(() => {
          const qb: any = {};
          for (const m of ['addSelect', 'where', 'andWhere', 'take'])
            qb[m] = () => qb;
          qb.getMany = async () => depsOver.led ?? [];
          return qb;
        }),
      },
    },
    view: { render: jest.fn(async (p: any) => ({ id: p.id })) },
    stage: { sync: jest.fn() },
    readiness: { assess: jest.fn() },
    checks: {
      list: jest.fn(async () => []),
      run: jest.fn(),
      resolve: jest.fn(),
    },
    builderSessions: { getSessionDetail: jest.fn() },
    messages: {
      appendMessage: jest.fn(),
      listBySession: jest.fn(async () => []),
    },
    access: {
      assertLead: jest.fn(),
      assertOwner: jest.fn(),
      isOwner: jest.fn(async () => true),
      canLead: jest.fn(async () => true),
      canRead: jest.fn(async () => true),
    },
    events: { record: jest.fn() },
    notifications: { notify: jest.fn() },
    settings: {
      assertEnabled: jest.fn(),
      get: jest.fn(async () => ({ enabled: true, closeConfirmVotes: 10 })),
      getRoadmapV2: jest.fn(async () => ({ enabled: false })),
    },
    spend: { summarize: jest.fn(async () => ({ totalUsd: 0 })) },
    dataSource: {
      query: jest.fn(async () => [{ opportunityId: 'opp1', votes: '3' }]),
    },
    ...depsOver,
  };
  const service = new PlanLeadService(
    deps.store,
    deps.view,
    deps.stage,
    deps.readiness,
    deps.checks,
    deps.builderSessions,
    deps.messages,
    deps.access,
    deps.events,
    deps.notifications,
    deps.settings,
    deps.spend,
    deps.dataSource,
  );
  return { service, deps, plan: () => plan };
}

describe('PlanLeadService', () => {
  it('takes a plan on with one atomic claim and tells the author', async () => {
    const { service, deps } = build();
    await service.takeOn('p1', 4);
    expect(deps.store.repository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1' }),
      { leadUserId: 4, updatedBy: 4 },
    );
    expect(deps.notifications.notify).toHaveBeenCalledWith(
      7,
      'p1',
      'taken_on',
      expect.any(String),
    );
    expect(deps.stage.sync).toHaveBeenCalled();
  });

  it('tells the loser of a take-on race who won', async () => {
    const { service, deps } = build({ leadUserId: 9 });
    deps.store.repository.update.mockResolvedValueOnce({ affected: 0 });
    await expect(service.takeOn('p1', 4)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('closes directly as not pursuing (an Owner)', async () => {
    const { service, deps, plan } = build({ leadUserId: 4 });
    await service.close(
      'p1',
      4,
      'Overlaps with the re-entry work already planned.',
    );
    expect(plan().plan.closed).toMatchObject({
      pendingConfirmation: false,
      by: 4,
    });
    expect(deps.notifications.notify).toHaveBeenCalledWith(
      7,
      'p1',
      'closed',
      expect.stringMatching(/Overlaps/),
    );
  });

  it('closes above the vote threshold with no second person: only an Owner closes now', async () => {
    const { service, deps, plan } = build(
      { leadUserId: 4 },
      {
        dataSource: {
          query: jest.fn(async () => [{ opportunityId: 'opp1', votes: '25' }]),
        },
      },
    );
    await service.close(
      'p1',
      4,
      'Overlaps with the re-entry work already planned.',
    );
    expect(plan().plan.closed.pendingConfirmation).toBe(false);
    expect(deps.events.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'closed' }),
    );
  });

  it('refuses take-on, close and reopen to anyone but an Owner', async () => {
    const { service, deps } = build({ leadUserId: null });
    deps.access.assertOwner.mockRejectedValue(new ForbiddenException('no'));
    await expect(service.takeOn('p1', 4)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.close(
        'p1',
        4,
        'Overlaps with the re-entry work already planned.',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.reopen('p1', 4)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('nudges after 7 quiet days and hands back after 14, never during a live build', async () => {
    const now = new Date('2026-05-01T00:00:00Z');
    const quiet8 = {
      id: 'a',
      title: 'A',
      createdBy: 1,
      leadUserId: 4,
      status: 'INTERVIEWING',
      updatedAt: new Date(now.getTime() - 8 * DAY),
      plan: {},
    };
    const quiet15 = {
      id: 'b',
      title: 'B',
      createdBy: 1,
      leadUserId: 4,
      status: 'PRD_READY',
      updatedAt: new Date(now.getTime() - 15 * DAY),
      plan: {},
    };
    const building = {
      id: 'c',
      title: 'C',
      createdBy: 1,
      leadUserId: 4,
      status: 'BUILDING',
      updatedAt: new Date(now.getTime() - 30 * DAY),
      plan: {},
    };
    const { service, deps } = build({}, { led: [quiet8, quiet15, building] });
    const result = await service.sweepLeads(now);
    expect(result).toEqual({ nudged: 1, released: 1 });
    expect(deps.notifications.notify).toHaveBeenCalledWith(
      4,
      'a',
      'nudge',
      expect.any(String),
    );
    expect(deps.events.record).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'b', kind: 'auto_released' }),
    );
    expect(deps.events.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'c' }),
    );
  });

  it('hands back a plan whose lead lost the Lead toggle', async () => {
    const lead = {
      id: 'a',
      title: 'A',
      createdBy: 1,
      leadUserId: 4,
      status: 'INTERVIEWING',
      updatedAt: new Date(),
      plan: {},
    };
    const { service, deps } = build({}, { led: [lead] });
    deps.access.canLead.mockResolvedValue(false);
    expect((await service.sweepLeads()).released).toBe(1);
  });

  it('with roadmap_v2 on, nudges but never hands a plan back (D11)', async () => {
    const now = new Date('2026-11-17T00:00:00Z');
    const plan = (id: string, days: number) => ({
      id,
      title: id,
      createdBy: 1,
      leadUserId: 4,
      status: 'PRD_READY',
      updatedAt: new Date(now.getTime() - days * DAY),
      plan: {},
    });
    const { service, deps } = build({}, { led: [plan('a', 8), plan('b', 15)] });
    deps.settings.getRoadmapV2.mockResolvedValue({ enabled: true });
    deps.access.canLead.mockResolvedValue(false);
    const result = await service.sweepLeads(now);
    expect(result.released).toBe(0);
    expect(deps.events.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'auto_released' }),
    );
    expect(deps.notifications.notify).toHaveBeenCalledWith(
      4,
      'a',
      'nudge',
      expect.any(String),
    );
  });

  it('lets only the author answer, and only a question that was asked', async () => {
    const { service, deps } = build({ leadUserId: 4 });
    await expect(
      service.answerAuthorQuestion('p1', 4, 'q1', 'x'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    deps.messages.listBySession.mockResolvedValue([
      { metadata: { askAuthor: { questionId: 'q1' } } },
    ]);
    await service.answerAuthorQuestion('p1', 7, 'q1', 'Learners on mobile.');
    expect(deps.messages.appendMessage).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        content: 'The author answered: Learners on mobile.',
      }),
    );
  });

  it('keeps code tags whatever the lead sends', async () => {
    const { service, plan } = build({
      leadUserId: 4,
      plan: {
        opportunityId: 'opp1',
        impactTags: [
          { id: 'crisis_or_helpline_path', source: 'code', at: 'x' },
        ],
      },
    });
    await service.setImpactTags('p1', 4, ['mobile']);
    expect(plan().plan.impactTags.map((t: any) => t.id)).toEqual([
      'crisis_or_helpline_path',
      'mobile',
    ]);
  });

  it('refuses to change a frozen success measure without a reason', async () => {
    const { service } = build({
      leadUserId: 4,
      plan: { opportunityId: 'opp1', measureFrozenAt: 'x' },
    });
    const measure: any = {
      metric: 'm',
      baseline: null,
      target: 't',
      guardrails: ['g'],
      method: { kind: 'manual', spec: 's' },
      reviewAfterDays: [14],
    };
    await expect(service.setSuccessMeasure('p1', 4, measure)).rejects.toThrow(
      /frozen/,
    );
  });
});
