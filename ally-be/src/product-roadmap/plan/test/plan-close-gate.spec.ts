import { ForbiddenException, HttpException } from '@nestjs/common';
import { planGateRegistry } from 'src/product-planning/service/plan-gate.registry';
import { PlanCloseReadinessService } from '../plan-close-readiness.service';
import { openingTurnMessage, PlanTurnService } from '../plan-turn.service';

const plan = (over: Record<string, unknown> = {}) =>
  ({
    id: 's-1',
    createdBy: 3,
    leadUserId: null,
    visibility: 'shared',
    archivedAt: null,
    plan: { planningStarted: true, planningStartedBy: 1, impactTags: [] },
    ...over,
  }) as never;

function gate(
  opts: {
    planBlockers?: string[];
    requirements?: unknown[];
    design?: Record<string, unknown> | null;
    designReadiness?: Record<string, unknown>;
    can?: Record<string, boolean>;
  } = {},
) {
  const deps = {
    store: {
      find: jest.fn(async () => plan()),
      findLinked: jest.fn(async () => plan()),
      patchPlan: jest.fn(),
    },
    builderSessions: {
      getSessionDetail: jest.fn(async () => ({
        prd: {
          requirements: opts.requirements ?? [{ id: 'R1' }],
          technicalDesign:
            opts.design === undefined ? { status: 'approved' } : opts.design,
        },
        readiness: { ready: true, sections: [] },
        designReadiness: opts.designReadiness ?? {
          ready: true,
          stale: false,
          blockers: [],
        },
      })),
    },
    readiness: {
      assess: jest.fn(async () => ({
        ready: !(opts.planBlockers ?? []).length,
        builderReady: true,
        blockers: opts.planBlockers ?? [],
      })),
    },
    checks: { run: jest.fn(async () => [{ id: 'pii', source: 'code' }]) },
    stage: { sync: jest.fn() },
    reader: {
      detail: jest.fn(async () => ({
        code: 'OPP-1',
        can: opts.can ?? { closePlan: true },
      })),
    },
    lookup: {
      get: jest.fn(async () => ({ code: 'OPP-1', builderSessionId: 's-1' })),
    },
  };
  const service = new PlanCloseReadinessService(
    ...(Object.values(deps) as unknown as ConstructorParameters<
      typeof PlanCloseReadinessService
    >),
  );
  return { service, deps };
}

describe('PlanCloseReadinessService', () => {
  afterEach(() => planGateRegistry.clear());

  it('a ready plan closes with or without a reason (the released page sends none)', async () => {
    const { service } = gate();
    await expect(service.checkClose(plan(), undefined)).resolves.toBeNull();
    await expect(
      service.checkClose(plan(), 'any words here'),
    ).resolves.toBeNull();
  });

  it('refuses to close an empty PRD without a reason, naming the blockers', async () => {
    const { service } = gate({
      planBlockers: ['Write the requirements.'],
      requirements: [],
      design: null,
    });
    const error = await service
      .checkClose(plan(), undefined)
      .catch((e: HttpException) => e);
    expect(error).toBeInstanceOf(HttpException);
    const body = (error as HttpException).getResponse() as Record<string, any>;
    expect((error as HttpException).getStatus()).toBe(409);
    expect(body.code).toBe('plan_not_ready');
    expect(body.prdEmpty).toBe(true);
    expect(body.blockers.map((b: { kind: string }) => b.kind)).toEqual([
      'prd',
      'design',
    ]);
  });

  it('refuses a reason too short to act on, and keeps a real one with the blockers', async () => {
    const { service } = gate({ planBlockers: ['Set a success measure.'] });
    await expect(service.checkClose(plan(), 'ok')).rejects.toBeInstanceOf(
      HttpException,
    );
    await expect(
      service.checkClose(plan(), '  We measure after the pilot.  '),
    ).resolves.toEqual({
      reason: 'We measure after the pilot.',
      blockers: ['Set a success measure.'],
    });
  });

  it('counts a check the PRD’s paths need before anyone has run it', async () => {
    const { service, deps } = gate();
    deps.builderSessions.getSessionDetail.mockImplementation(async () => ({
      prd: {
        requirements: [{ id: 'R1' }],
        technicalPlan: { repos: [{ changesMd: 'ally-be/src/llm/x.ts' }] },
        technicalDesign: { status: 'approved' },
      },
      readiness: { ready: true, sections: [] },
      designReadiness: { ready: true, stale: false, blockers: [] },
    }));
    await service.assess(plan());
    const [assessed] = deps.readiness.assess.mock.calls[0] as unknown as [
      { plan: { impactTags: unknown[] } },
    ];
    expect(assessed.plan.impactTags).toEqual([
      expect.objectContaining({
        id: 'prompt_or_model_change',
        source: 'code',
      }),
    ]);
  });

  it('the dialog list is for an Owner or the builder working the plan only', async () => {
    const { service } = gate({ can: {} });
    await expect(service.forItem(5, 'OPP-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('registers with the gate registry; a plan not being planned has no gate', async () => {
    const { service, deps } = gate();
    service.onModuleInit();
    await expect(planGateRegistry.readiness('s-1')).resolves.toMatchObject({
      ready: true,
    });
    deps.store.find.mockImplementation(async () =>
      plan({ plan: { planningStarted: false } }),
    );
    await expect(planGateRegistry.readiness('s-1')).resolves.toBeNull();
  });

  it('runs the reviewers when the PRD first reads ready, and stores the tags', async () => {
    const { service, deps } = gate();
    await service.runReviewers('s-1');
    expect(deps.checks.run).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's-1' }),
      expect.any(Object),
      1,
    );
    expect(deps.store.patchPlan).toHaveBeenCalledWith('s-1', {
      impactTags: [{ id: 'pii', source: 'code' }],
    });
  });
});

describe('PlanTurnService', () => {
  const build = (can: Record<string, boolean>, startError?: Error) => {
    const deps = {
      decisions: {
        startBackgroundTurn: jest.fn(async () => {
          if (startError) throw startError;
        }),
      },
      reader: {
        detail: jest.fn(async () => ({
          code: 'OPP-1',
          title: 'Streak reminders',
          shownStage: 'planning',
          can,
        })),
      },
      lookup: {
        get: jest.fn(async () => ({ code: 'OPP-1', builderSessionId: 's-1' })),
      },
      broadcast: { emit: jest.fn() },
    };
    const service = new PlanTurnService(
      ...(Object.values(deps) as unknown as ConstructorParameters<
        typeof PlanTurnService
      >),
    );
    return { service, deps };
  };

  it('the planner’s message starts a turn', async () => {
    const { service, deps } = build({ workPlan: true });
    await service.send(1, 'OPP-1', '  What about mobile?  ');
    expect(deps.decisions.startBackgroundTurn).toHaveBeenCalledWith(
      's-1',
      'What about mobile?',
      1,
    );
  });

  it('nothing typed asks for the opening situation brief', async () => {
    const { service, deps } = build({ workPlan: true });
    await service.send(1, 'OPP-1', undefined);
    expect(deps.decisions.startBackgroundTurn).toHaveBeenCalledWith(
      's-1',
      openingTurnMessage('OPP-1', 'Streak reminders'),
      1,
    );
  });

  it('anyone else is refused', async () => {
    const { service, deps } = build({ comment: true });
    await expect(service.send(4, 'OPP-1', 'hi')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(deps.decisions.startBackgroundTurn).not.toHaveBeenCalled();
  });

  it('the opening turn never throws, even when the turn cannot start', async () => {
    const { service } = build({}, new Error('busy'));
    expect(() =>
      service.queueOpeningTurn('s-1', 1, 'OPP-1', 'T'),
    ).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
  });
});
