import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { PolicyServiceKey } from '../../constants/release-policy.constants';
import {
  ReleasePolicyBreakerEvent,
  ReleasePolicyComparison,
  ReleasePolicyDecision,
  ReleasePolicyLogKind,
  ReleasePolicyMode,
  ReleasePolicyOrigin,
  ReleasePolicyOutcome,
} from '../../enum/release-policy.enum';
import { RoadmapV2EnabledGuard } from '../../guard/roadmap-v2-enabled.guard';
import { ServiceReleasePlan } from '../../util/release-policy.util';
import { ReleasePolicyService, policyMode } from '../release-policy.service';
import { roadmapV2From } from '../release-policy-settings.service';

jest.mock('src/logger/logger.service', () => ({
  LoggerService: {
    getInstance: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  },
}));

/**
 * The shadow policy against mocked GitHub, plans and tables. The rules are in
 * release-policy.util.spec; this covers what is written, what is never
 * called, and the flag and role gates on the release endpoints.
 */

const NOW = new Date('2026-11-17T12:00:00Z');
const LONG_AGO = new Date('2026-11-17T10:00:00Z');

/** An in-memory `release_policy_log` with the repository calls the service makes. */
function logTable() {
  const rows: any[] = [];
  let clock = Date.parse('2026-11-17T09:00:00Z');
  const test = (value: any, cell: any): boolean => {
    if (value && typeof value === 'object' && '_type' in value) {
      if (value._type === 'in') return value._value.includes(cell);
      if (value._type === 'isNull') return cell == null;
      if (value._type === 'lessThan') return cell < value._value;
      return true;
    }
    return cell === value;
  };
  const matches = (row: any, where: any = {}) =>
    Object.entries(where).every(([key, value]) => test(value, row[key]));
  const sorted = (list: any[], order: any = {}) => {
    const [[key, dir] = ['createdAt', 'ASC']] = Object.entries(order);
    return [...list].sort((a, b) =>
      dir === 'DESC' ? (b[key] > a[key] ? 1 : -1) : a[key] > b[key] ? 1 : -1,
    );
  };
  return {
    rows,
    create: (value: any) => ({ ...value }),
    save: jest.fn(async (value: any) => {
      clock += 1000;
      const row = {
        id: `log-${rows.length + 1}`,
        commits: [],
        heldReasons: [],
        opportunityIds: [],
        healthAttempts: 0,
        createdAt: new Date(clock),
        ...value,
      };
      rows.push(row);
      return row;
    }),
    find: jest.fn(async (opts: any = {}) =>
      sorted(
        rows.filter((row) => matches(row, opts.where)),
        opts.order,
      ).slice(0, opts.take ?? Infinity),
    ),
    findOne: jest.fn(
      async (opts: any = {}) =>
        sorted(
          rows.filter((row) => matches(row, opts.where)),
          opts.order,
        )[0] ?? null,
    ),
    update: jest.fn(async (where: any, patch: any) => {
      for (const row of rows.filter((r) => matches(r, where)))
        Object.assign(row, patch);
      return { affected: 1 };
    }),
  };
}

function plan(
  service: PolicyServiceKey,
  overrides: Partial<ServiceReleasePlan> = {},
): ServiceReleasePlan {
  return {
    service,
    baseRef: 'be-v1.0.0',
    baseTag: 'be-v1.0.0',
    headSha: 'master-1',
    opportunityIds: ['opp-1'],
    commits: [
      {
        sha: 'aaaaaaa1',
        title: 'work',
        authorLogin: 'someone',
        committedAt: LONG_AGO.toISOString(),
        prNumber: 7,
        merge: false,
        held: false,
      },
    ],
    heldReasons: [],
    apps: service === 'frontend' ? 'admin' : null,
    prNumbers: [7],
    lastChangeAt: LONG_AGO,
    serviceHeadSha: 'aaaaaaa1',
    unknown: null,
    ...overrides,
  };
}

const nothing = (service: PolicyServiceKey) =>
  plan(service, {
    commits: [],
    prNumbers: [],
    lastChangeAt: null,
    serviceHeadSha: null,
    opportunityIds: [],
  });

function build(
  options: {
    settings?: Record<string, unknown>;
    plans?: ServiceReleasePlan[];
    runs?: any[];
    owner?: boolean;
    lead?: boolean;
    activeRuns?: number | null;
  } = {},
) {
  const log = logTable();
  const settings = {
    roadmapV2: true,
    heldPaths: [],
    releaseWindow: null,
    autoReleaseEnabled: false,
    autoReleasePolicyLive: false,
    autoReleasePausedAt: null,
    autoReleasePausedReason: null,
    ...options.settings,
  };
  const plans = options.plans ?? [
    plan('be'),
    nothing('ai'),
    nothing('learn'),
    nothing('frontend'),
  ];
  const beHead = {
    ref: 'be-v1.0.0',
    tag: 'be-v1.0.0',
    runs: options.runs ?? [],
  };
  const planService = {
    buildPlans: jest.fn(async () => ({
      masterSha: 'master-1',
      plans: new Map(plans.map((p) => [p.service, p])),
      heads: new Map<string, any>([
        ['be', beHead],
        ['ai', null],
        ['learn', null],
        ['frontend:admin', null],
        ['frontend:helpline', null],
      ]),
    })),
    serviceCommitsBetween: jest.fn(async () => 0),
  };
  const settingsService = {
    get: jest.fn(async () => settings),
    isRoadmapV2Enabled: jest.fn(async () => settings.roadmapV2 === true),
    pause: jest.fn(async (reason: string, at: Date) => {
      if (settings.autoReleasePausedAt) return false;
      Object.assign(settings, {
        autoReleasePausedAt: at,
        autoReleasePausedReason: reason,
      });
      return true;
    }),
    resume: jest.fn(async () => {
      const was = settings.autoReleasePausedAt;
      Object.assign(settings, {
        autoReleasePausedAt: null,
        autoReleasePausedReason: null,
      });
      return was;
    }),
  };
  const accessService = {
    isOwner: jest.fn(async () => options.owner ?? false),
    canView: jest.fn(async () => true),
    canRelease: jest.fn(
      async () => (options.owner ?? false) || (options.lead ?? false),
    ),
  };
  const notifier = { breakerTripped: jest.fn(async () => undefined) };
  const github = {
    isConfigured: true,
    nextPatchTag: jest.fn(async () => 'be-v1.0.1'),
    countActiveRuns: jest.fn(async () =>
      options.activeRuns === undefined ? 0 : options.activeRuns,
    ),
    dispatchWorkflow: jest.fn(),
  };
  const releaseService = {
    dispatch: jest.fn(async () => ({
      tag: 'be-v1.0.1',
      dispatchedAt: NOW,
    })),
  };
  const configService = { builderHealthUrls: {} };
  const runner = {
    connect: jest.fn(),
    release: jest.fn(),
    query: jest.fn(async (sql: string) =>
      sql.includes('pg_try_advisory_lock') ? [{ locked: true }] : [],
    ),
  };
  const dataSource = { createQueryRunner: () => runner };

  const service = new ReleasePolicyService(
    log as any,
    planService as any,
    settingsService as any,
    accessService as any,
    notifier as any,
    github as any,
    releaseService as any,
    configService as any,
    dataSource as any,
  );
  return {
    service,
    log,
    settings,
    planService,
    settingsService,
    accessService,
    notifier,
    github,
    releaseService,
  };
}

const decisions = (log: ReturnType<typeof logTable>) =>
  log.rows.filter((row) => row.kind === ReleasePolicyLogKind.DECISION);

function run(
  id: string,
  conclusion: string,
  startedAt: string,
  headSha = 'master-1',
) {
  const start = new Date(startedAt);
  return {
    id,
    htmlUrl: `https://github.example/run/${id}`,
    conclusion,
    createdAt: start,
    startedAt: start,
    finishedAt: new Date(start.getTime() + 15 * 60_000),
    headSha,
    title: 'Production release',
  };
}

describe('ReleasePolicyService — shadow mode never dispatches', () => {
  it('is shadow whatever the settings say', () => {
    expect(policyMode()).toBe(ReleasePolicyMode.SHADOW);
  });

  it('logs "would release" with the tag and commits, and calls no dispatch — even with every live switch on', async () => {
    const { service, log, github, releaseService } = build({
      settings: { autoReleaseEnabled: true, autoReleasePolicyLive: true },
    });

    await service.tick(NOW);

    const be = decisions(log).find((row) => row.service === 'be');
    expect(be).toMatchObject({
      mode: ReleasePolicyMode.SHADOW,
      decision: ReleasePolicyDecision.RELEASE,
      tag: 'be-v1.0.1',
      baseTag: 'be-v1.0.0',
      serviceHeadSha: 'aaaaaaa1',
      opportunityIds: ['opp-1'],
    });
    expect(be.commits.map((c: any) => c.sha)).toEqual(['aaaaaaa1']);
    expect(releaseService.dispatch).not.toHaveBeenCalled();
    expect(github.dispatchWorkflow).not.toHaveBeenCalled();
  });

  it('writes a decision only when it changes', async () => {
    const { service, log } = build();
    await service.tick(NOW);
    const first = decisions(log).length;
    await service.tick(new Date(NOW.getTime() + 5 * 60_000));
    expect(decisions(log).length).toBe(first);
    expect(first).toBe(4);
  });

  it('logs held and debouncing services, and the frontend waiting for the backend', async () => {
    const { service, log, releaseService } = build({
      plans: [
        plan('be', {
          heldReasons: [
            {
              sha: 'aaaaaaa1',
              file: 'ally-be/src/database/migrations/1-X.ts',
              rule: 'ally-be/src/database/migrations/**',
            },
          ],
        }),
        plan('ai', { lastChangeAt: new Date(NOW.getTime() - 60_000) }),
        nothing('learn'),
        plan('frontend'),
      ],
    });
    await service.tick(NOW);

    const by = (s: string) => decisions(log).find((row) => row.service === s);
    expect(by('be').decision).toBe(ReleasePolicyDecision.HELD);
    expect(by('be').heldReasons).toHaveLength(1);
    expect(by('ai').decision).toBe(ReleasePolicyDecision.DEBOUNCING);
    expect(by('frontend').decision).toBe(ReleasePolicyDecision.WAITING_BACKEND);
    expect(by('frontend').reason).toBe('waiting for be, ai');
    expect(releaseService.dispatch).not.toHaveBeenCalled();
  });

  it('does nothing without a GitHub token', async () => {
    const { service, github, planService } = build();
    (github as any).isConfigured = false;
    await service.tick(NOW);
    expect(planService.buildPlans).not.toHaveBeenCalled();
  });
});

describe('ReleasePolicyService — what humans released', () => {
  it('records a release that matches the policy’s decision, and ignores history from before it started', async () => {
    const ctx = build();
    await ctx.service.tick(NOW); // first pass: decides, starts observing

    ctx.planService.buildPlans.mockImplementation(async () => ({
      masterSha: 'master-1',
      plans: new Map(
        [
          nothing('be'),
          nothing('ai'),
          nothing('learn'),
          nothing('frontend'),
        ].map((p) => [p.service, p]),
      ),
      heads: new Map<string, any>([
        [
          'be',
          {
            ref: 'be-v1.0.1',
            tag: 'be-v1.0.1',
            runs: [
              run('old', 'success', '2026-11-01T10:00:00Z'),
              run('r1', 'success', '2026-11-17T12:30:00Z'),
            ],
          },
        ],
      ]),
    }));
    await ctx.service.tick(new Date('2026-11-17T13:00:00Z'));

    const observed = ctx.log.rows.filter(
      (row) => row.kind === ReleasePolicyLogKind.OBSERVED_RELEASE,
    );
    expect(observed.map((row) => row.runId)).toEqual(['r1']);
    expect(observed[0]).toMatchObject({
      service: 'be',
      outcome: ReleasePolicyOutcome.SUCCEEDED,
      origin: ReleasePolicyOrigin.HUMAN,
      comparison: ReleasePolicyComparison.MATCH,
      tag: 'be-v1.0.1',
    });
    expect(ctx.planService.serviceCommitsBetween).toHaveBeenCalledWith(
      'be',
      'master-1',
      'master-1',
      undefined,
    );
  });
});

describe('ReleasePolicyService — circuit breaker', () => {
  function withObserved(ctx: ReturnType<typeof build>, rows: any[]) {
    rows.forEach((row, i) =>
      ctx.log.rows.push({
        id: `obs-${i}`,
        kind: ReleasePolicyLogKind.OBSERVED_RELEASE,
        service: 'be',
        comparison: ReleasePolicyComparison.NO_DECISION,
        healthCheckedAt: new Date(),
        healthAttempts: 0,
        createdAt: new Date(`2026-11-17T0${i + 1}:00:00Z`),
        finishedAt: new Date(`2026-11-17T0${i + 1}:00:00Z`),
        ...row,
      }),
    );
  }

  it('shadow: two failed human releases record "would trip", and pause nothing', async () => {
    const ctx = build({
      plans: [
        nothing('be'),
        nothing('ai'),
        nothing('learn'),
        nothing('frontend'),
      ],
    });
    withObserved(ctx, [
      {
        runId: 'a',
        outcome: ReleasePolicyOutcome.FAILED,
        origin: ReleasePolicyOrigin.HUMAN,
      },
      {
        runId: 'b',
        outcome: ReleasePolicyOutcome.SUCCEEDED,
        healthy: false,
        origin: ReleasePolicyOrigin.HUMAN,
      },
    ]);

    await ctx.service.tick(NOW);
    await ctx.service.tick(NOW);

    const breaker = ctx.log.rows.filter(
      (row) => row.kind === ReleasePolicyLogKind.BREAKER,
    );
    expect(breaker).toHaveLength(1);
    expect(breaker[0]).toMatchObject({
      breakerEvent: ReleasePolicyBreakerEvent.WOULD_TRIP,
      mode: ReleasePolicyMode.SHADOW,
      runId: 'b',
    });
    expect(ctx.settingsService.pause).not.toHaveBeenCalled();
    expect(ctx.notifier.breakerTripped).not.toHaveBeenCalled();
  });

  it('trips once on two consecutive failed or unhealthy releases the policy made, and notifies the Owners', async () => {
    const ctx = build({
      plans: [plan('be'), nothing('ai'), nothing('learn'), nothing('frontend')],
    });
    withObserved(ctx, [
      {
        runId: 'a',
        outcome: ReleasePolicyOutcome.FAILED,
        origin: ReleasePolicyOrigin.POLICY,
      },
      {
        runId: 'b',
        outcome: ReleasePolicyOutcome.SUCCEEDED,
        healthy: false,
        origin: ReleasePolicyOrigin.POLICY,
      },
    ]);

    await ctx.service.tick(NOW);
    await ctx.service.tick(NOW);

    expect(ctx.settingsService.pause).toHaveBeenCalledTimes(1);
    expect(ctx.settings.autoReleasePausedAt).toBeInstanceOf(Date);
    expect(ctx.notifier.breakerTripped).toHaveBeenCalledTimes(1);
    expect(
      ctx.log.rows.filter(
        (row) => row.breakerEvent === ReleasePolicyBreakerEvent.TRIPPED,
      ),
    ).toHaveLength(1);
    // The next decision for be says paused, and still nothing is dispatched.
    const be = decisions(ctx.log).filter((row) => row.service === 'be');
    expect(be[be.length - 1].decision).toBe(ReleasePolicyDecision.PAUSED);
    expect(ctx.releaseService.dispatch).not.toHaveBeenCalled();
  });

  it('does not trip on one failure followed by a healthy release', async () => {
    const ctx = build();
    withObserved(ctx, [
      {
        runId: 'a',
        outcome: ReleasePolicyOutcome.FAILED,
        origin: ReleasePolicyOrigin.POLICY,
      },
      {
        runId: 'b',
        outcome: ReleasePolicyOutcome.SUCCEEDED,
        healthy: true,
        origin: ReleasePolicyOrigin.POLICY,
      },
    ]);
    await ctx.service.tick(NOW);
    expect(ctx.settingsService.pause).not.toHaveBeenCalled();
  });

  it('resume is Owner-only, clears the pause and logs who', async () => {
    const pausedAt = new Date('2026-11-17T08:00:00Z');
    const denied = build({ settings: { autoReleasePausedAt: pausedAt } });
    await expect(denied.service.resume(5)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(denied.settingsService.resume).not.toHaveBeenCalled();

    const owner = build({
      owner: true,
      settings: { autoReleasePausedAt: pausedAt },
    });
    await expect(owner.service.resume(1)).resolves.toEqual({
      pausedAt: null,
      wasPausedAt: pausedAt,
    });
    expect(owner.settings.autoReleasePausedAt).toBeNull();
    expect(owner.log.rows).toEqual([
      expect.objectContaining({
        kind: ReleasePolicyLogKind.BREAKER,
        breakerEvent: ReleasePolicyBreakerEvent.RESUMED,
        userId: 1,
      }),
    ]);
  });
});

describe('ReleasePolicyService — release endpoints behind roadmap_v2', () => {
  it('404s every endpoint while the flag is off, and dispatches nothing', async () => {
    const ctx = build({ owner: true, settings: { roadmapV2: false } });
    await expect(ctx.service.getPlan(1, 'be')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      ctx.service.release(1, 'be', 'aaaaaaa1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctx.service.resume(1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(ctx.releaseService.dispatch).not.toHaveBeenCalled();
    expect(ctx.planService.buildPlans).not.toHaveBeenCalled();
  });

  it('the controller guard 404s while the flag is off', async () => {
    const off = new RoadmapV2EnabledGuard({
      isRoadmapV2Enabled: async () => false,
    } as any);
    await expect(off.canActivate()).rejects.toBeInstanceOf(NotFoundException);
    const on = new RoadmapV2EnabledGuard({
      isRoadmapV2Enabled: async () => true,
    } as any);
    await expect(on.canActivate()).resolves.toBe(true);
  });

  it('reads the flag only when it is really true', () => {
    expect(roadmapV2From({})).toBe(false);
    expect(roadmapV2From({ roadmapV2: 'true' })).toBe(false);
    expect(roadmapV2From({ roadmapV2: true })).toBe(true);
    expect(roadmapV2From({ roadmap_v2: true })).toBe(true);
  });

  it('shows the plan: commits, held reasons, next tag and the policy’s decision', async () => {
    const ctx = build({ lead: true });
    const view = await ctx.service.getPlan(9, 'be');
    expect(view).toMatchObject({
      service: 'be',
      nextTag: 'be-v1.0.1',
      serviceHeadSha: 'aaaaaaa1',
      held: false,
      mode: ReleasePolicyMode.SHADOW,
      canRelease: true,
    });
    expect(view.decision.decision).toBe(ReleasePolicyDecision.RELEASE);
    await expect(ctx.service.getPlan(9, 'mobile')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses a Release click from someone who is neither an Owner nor a lead in the range', async () => {
    const ctx = build();
    await expect(
      ctx.service.release(9, 'be', 'aaaaaaa1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(ctx.releaseService.dispatch).not.toHaveBeenCalled();
  });

  it('dispatches a held service for its lead through ProductionReleaseService, even while paused, and logs it', async () => {
    const ctx = build({
      lead: true,
      settings: { autoReleasePausedAt: new Date('2026-11-17T08:00:00Z') },
      plans: [
        plan('be', {
          heldReasons: [
            {
              sha: 'aaaaaaa1',
              file: 'ally-be/src/auth/x.ts',
              rule: '**/auth/**',
            },
          ],
        }),
        nothing('ai'),
        nothing('learn'),
        nothing('frontend'),
      ],
    });
    const result = await ctx.service.release(9, 'be', 'aaaaaaa1');
    expect(result).toMatchObject({ service: 'be', tag: 'be-v1.0.1' });
    expect(ctx.releaseService.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ workflow: 'production-release-ally-be.yaml' }),
      'master',
    );
    expect(ctx.log.rows).toEqual([
      expect.objectContaining({
        kind: ReleasePolicyLogKind.MANUAL_RELEASE,
        mode: ReleasePolicyMode.MANUAL,
        userId: 9,
        tag: 'be-v1.0.1',
        heldReasons: [expect.objectContaining({ rule: '**/auth/**' })],
      }),
    ]);
  });

  it('refuses when more of the service landed since the plan was read, or a release is running', async () => {
    const moved = build({ owner: true });
    await expect(
      moved.service.release(1, 'be', 'bbbbbbb2'),
    ).rejects.toBeInstanceOf(ConflictException);
    const running = build({ owner: true, activeRuns: 1 });
    await expect(
      running.service.release(1, 'be', 'aaaaaaa1'),
    ).rejects.toBeInstanceOf(ConflictException);
    const blind = build({ owner: true, activeRuns: null });
    await expect(
      blind.service.release(1, 'be', 'aaaaaaa1'),
    ).rejects.toBeInstanceOf(ConflictException);
    for (const ctx of [moved, running, blind]) {
      expect(ctx.releaseService.dispatch).not.toHaveBeenCalled();
    }
  });

  it('refuses when there is nothing to release', async () => {
    const ctx = build({
      owner: true,
      plans: [
        nothing('be'),
        nothing('ai'),
        nothing('learn'),
        nothing('frontend'),
      ],
    });
    await expect(
      ctx.service.release(1, 'be', 'aaaaaaa1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
