import { BadRequestException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { BuilderBuildService } from '../builder-build.service';
import { BuilderPullRequestService } from '../builder-pull-request.service';
import { BuilderBuildRunRepository } from '../../repository/builder-build.repository';
import {
  BuilderRunMode,
  BuilderRunStatus,
  BuilderSessionStatus,
} from '../../enum/builder.enum';
import { createDraftingDesign } from '../../util/builder-technical-design.util';

/**
 * Builder running several sessions' builds at once.
 *
 * `maxConcurrentBuilds` is 1 in production. Raising it is only safe if the
 * per-session machinery (run numbering, the circuit breaker, the budget hold,
 * the pull-request counters) stays per-session while the one global thing, the
 * concurrency ceiling, counts across all of them. These tests drive the real
 * services against small stateful in-memory fakes of the repositories, so a
 * query that forgot its `sessionId` shows up as one session's data leaking into
 * another's, which a `mockResolvedValue` fake could never show.
 */

type Row = Record<string, any>;

/** Evaluates a TypeORM-style `where` against plain rows (equality, In, IsNull). */
const matches = (row: Row, where: Row = {}): boolean =>
  Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected instanceof FindOperator) {
      if (expected.type === 'in') {
        return (expected.value as unknown[]).includes(actual);
      }
      if (expected.type === 'isNull') return actual == null;
      throw new Error(`Unsupported operator in fake: ${expected.type}`);
    }
    return actual === expected;
  });

const approvedDoc = () => {
  const draft: Row = { requirements: [], technicalPlan: '' };
  draft.technicalDesign = {
    ...createDraftingDesign(draft as never, 'design-run'),
    status: 'approved',
  };
  return { draft, versionNumber: 1 };
};

const sessionRow = (id: string, overrides: Row = {}): Row => ({
  id,
  slug: `slug-${id}`,
  title: `Session ${id}`,
  status: BuilderSessionStatus.PRD_READY,
  repos: ['ally-be'],
  model: 'claude-sonnet-5',
  budgetUsd: null,
  totalCostUsd: '0',
  runnerMinutes: 0,
  createdBy: 1,
  lastRunSequence: 0,
  ...overrides,
});

describe('Builder concurrency: several sessions at once', () => {
  let service: BuilderBuildService;
  let sessions: Map<string, Row>;
  let runs: Row[];
  let pullRequests: Map<string, Row>;
  let settings: Row;
  let github: Row;
  let redisService: { acquireLock: jest.Mock; releaseLock: jest.Mock };
  let notificationService: Row;
  let runRepository: Row;
  let pullRequestRepository: Row;
  let sessionRepository: Row;
  let eventRepository: Row;
  let runCounter: number;

  const activeIn = (statuses: BuilderRunStatus[]) =>
    runs.filter((run) => statuses.includes(run.status));

  /** What the database does when a runner finishes: the row changes state. */
  const settle = (runId: string, status: BuilderRunStatus) => {
    const run = runs.find((row) => row.id === runId) as Row;
    run.status = status;
  };

  const addRun = (sessionId: string, overrides: Row = {}): Row => {
    const session = sessions.get(sessionId) as Row;
    session.lastRunSequence += 1;
    const run = {
      id: `run-${++runCounter}`,
      sessionId,
      sequence: session.lastRunSequence,
      mode: BuilderRunMode.BUILD,
      status: BuilderRunStatus.SUCCEEDED,
      repos: ['ally-be'],
      ...overrides,
    };
    runs.push(run);
    return run;
  };

  beforeEach(() => {
    runCounter = 0;
    sessions = new Map(
      ['s1', 's2', 's3'].map((id) => [id, sessionRow(id)] as const),
    );
    runs = [];
    pullRequests = new Map();
    settings = {
      enabled: true,
      maxConcurrentBuilds: 3,
      autoReviewEnabled: true,
      autoFixEnabled: true,
      maxFixRunsPerPr: 3,
    };

    github = {
      isConfigured: true,
      dispatchWorkflow: jest.fn().mockResolvedValue(new Date()),
      findRunSince: jest.fn().mockResolvedValue(null),
      cancelRun: jest.fn(),
      getRun: jest.fn().mockResolvedValue(null),
      createIssue: jest.fn(async () => ({
        number: 100 + github.createIssue.mock.calls.length,
        htmlUrl: 'https://github.com/o/ally-be/issues/1',
        labels: ['builder'],
      })),
      addIssueLabels: jest.fn().mockResolvedValue(['builder']),
      closeIssue: jest.fn(),
    };

    runRepository = {
      save: jest.fn(async (run: Row) => {
        const saved = { id: `run-${++runCounter}`, ...run };
        runs.push(saved);
        return saved;
      }),
      create: jest.fn((run: Row) => run),
      update: jest.fn(async (where: Row, patch: Row) => {
        runs
          .filter((run) => matches(run, where))
          .forEach((run) => {
            Object.assign(run, patch);
          });
      }),
      find: jest.fn(async ({ where, order, take }: Row = {}) => {
        let found = runs.filter((run) => matches(run, where));
        if (order?.sequence === 'DESC') {
          found = [...found].sort((a, b) => b.sequence - a.sequence);
        }
        return take ? found.slice(0, take) : found;
      }),
      findOne: jest.fn(
        async ({ where, order }: Row = {}) =>
          [...runs]
            .filter((run) => matches(run, where))
            .sort((a, b) =>
              order?.sequence === 'DESC'
                ? b.sequence - a.sequence
                : a.sequence - b.sequence,
            )[0] ?? null,
      ),
      count: jest.fn(
        async ({ where }: Row = {}) =>
          runs.filter((run) => matches(run, where)).length,
      ),
      listActive: jest.fn(async () =>
        activeIn([BuilderRunStatus.QUEUED, BuilderRunStatus.RUNNING]),
      ),
      // Mirrors the real query's shape: scoped to the session.
      listRecent: jest.fn(async (sessionId: string, take: number) =>
        runs
          .filter((run) => run.sessionId === sessionId)
          .sort((a, b) => b.sequence - a.sequence)
          .slice(0, take),
      ),
      countBlockingRuns: jest.fn(
        async (sessionId: string) =>
          runs.filter(
            (run) =>
              run.sessionId === sessionId &&
              [BuilderRunStatus.QUEUED, BuilderRunStatus.RUNNING].includes(
                run.status,
              ),
          ).length,
      ),
      findLatest: jest.fn(
        async (sessionId: string) =>
          runs
            .filter((run) => run.sessionId === sessionId)
            .sort((a, b) => b.sequence - a.sequence)[0] ?? null,
      ),
      isLatestForSession: jest.fn().mockResolvedValue(false),
      nextSequence: jest.fn(async (sessionId: string) => {
        const session = sessions.get(sessionId);
        if (!session) throw new Error(`no session ${sessionId}`);
        session.lastRunSequence += 1;
        return session.lastRunSequence;
      }),
    };

    sessionRepository = {
      findOne: jest.fn(
        async ({ where }: Row) =>
          [...sessions.values()].find((row) => matches(row, where)) ?? null,
      ),
      update: jest.fn(async (where: Row, patch: Row) => {
        [...sessions.values()]
          .filter((row) => matches(row, where))
          .forEach((row) => Object.assign(row, patch));
      }),
      increment: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    };

    eventRepository = {
      listByRun: jest.fn().mockResolvedValue([]),
      // No file edit anywhere: a failed run converged on nothing.
      latestOfType: jest.fn().mockResolvedValue(null),
    };

    pullRequestRepository = {
      count: jest.fn(
        async ({ where }: Row = {}) =>
          [...pullRequests.values()].filter((row) => matches(row, where))
            .length,
      ),
      find: jest.fn(async ({ where }: Row = {}) =>
        [...pullRequests.values()].filter((row) => matches(row, where)),
      ),
      findOne: jest.fn(
        async ({ where }: Row = {}) =>
          [...pullRequests.values()].find((row) => matches(row, where)) ?? null,
      ),
      update: jest.fn(async (where: Row, patch: Row) => {
        [...pullRequests.values()]
          .filter((row) => matches(row, where))
          .forEach((row) => Object.assign(row, patch));
      }),
      increment: jest.fn(async (where: Row, column: string, by: number) => {
        [...pullRequests.values()]
          .filter((row) => matches(row, where))
          .forEach((row) => {
            row[column] = Number(row[column] ?? 0) + by;
          });
      }),
      findOneOrFail: jest.fn(async ({ where }: Row) => {
        const found = [...pullRequests.values()].find((row) =>
          matches(row, where),
        );
        if (!found) throw new Error('not found');
        return found;
      }),
      listReconcilable: jest.fn(async () =>
        [...pullRequests.values()].filter((row) => !row.merged),
      ),
      listBySession: jest.fn(async (sessionId: string) =>
        [...pullRequests.values()].filter((row) => row.sessionId === sessionId),
      ),
    };

    notificationService = {
      buildCompleted: jest.fn(),
      buildFailed: jest.fn(),
      budgetReached: jest.fn(),
      automationPaused: jest.fn(),
    };
    // SET NX semantics, like Redis: a held key refuses a second taker.
    const held = new Set<string>();
    redisService = {
      acquireLock: jest.fn(async (key: string) => {
        if (held.has(key)) return false;
        held.add(key);
        return true;
      }),
      releaseLock: jest.fn(async (key: string) => {
        held.delete(key);
      }),
    };

    const prdService = {
      getOrCreateDoc: jest.fn(async () => approvedDoc()),
      setTechnicalDesign: jest.fn().mockResolvedValue({}),
    };

    service = new BuilderBuildService(
      {
        publicApiBaseUrl: 'http://be',
        builder: {
          coderModel: 'claude-sonnet-5',
          plannerModel: 'claude-opus-5',
          verifierModel: 'claude-opus-5',
          mechanicalModel: 'claude-haiku-4-5',
        },
      } as never,
      github as never,
      sessionRepository as never,
      runRepository as never,
      eventRepository as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      pullRequestRepository as never,
      { get: jest.fn(async () => settings) } as never,
      notificationService as never,
      { record: jest.fn() } as never,
      redisService as never,
      { archiveSession: jest.fn().mockResolvedValue(null) } as never,
      {
        nextPending: jest.fn().mockResolvedValue(null),
        unbuiltRepoMilestone: jest.fn().mockResolvedValue(null),
        markStatus: jest.fn(),
        listBySession: jest.fn().mockResolvedValue([]),
        ensureRepoMilestones: jest.fn().mockResolvedValue(undefined),
      } as never,
      { record: jest.fn().mockResolvedValue(undefined) } as never,
      prdService as never,
      { assess: jest.fn().mockResolvedValue({ ready: true }) } as never,
    );
  });

  const start = (id: string) =>
    service.startBuild(sessions.get(id) as never, 1);
  const design = (id: string) =>
    service.startDesign(sessions.get(id) as never, 1);

  describe('run sequence numbers', () => {
    it('are allocated per session: each of three sessions gets its own 1, 2', async () => {
      await Promise.all([start('s1'), start('s2'), start('s3')]);
      for (const id of ['s1', 's2', 's3']) {
        expect(runs.filter((run) => run.sessionId === id)).toEqual([
          expect.objectContaining({ sequence: 1, mode: BuilderRunMode.BUILD }),
        ]);
      }

      // Every build finishes; each session then takes a second run (a design).
      runs.forEach((run) => (run.status = BuilderRunStatus.SUCCEEDED));
      sessions.forEach((row) => (row.status = BuilderSessionStatus.PRD_READY));
      await Promise.all([design('s1'), design('s2'), design('s3')]);

      for (const id of ['s1', 's2', 's3']) {
        const own = runs.filter((run) => run.sessionId === id);
        expect(own.map((run) => run.sequence).sort()).toEqual([1, 2]);
      }
      // The counter was only ever asked about the session being dispatched.
      const asked = runRepository.nextSequence.mock.calls.map(
        (call: string[]) => call[0],
      );
      expect(asked.sort()).toEqual(['s1', 's1', 's2', 's2', 's3', 's3']);
    });

    it('a busy session does not advance another session’s counter', async () => {
      addRun('s1');
      addRun('s1');
      addRun('s1');

      await start('s2');

      expect(runs.find((run) => run.sessionId === 's2')?.sequence).toBe(1);
      expect(sessions.get('s1')?.lastRunSequence).toBe(3);
    });

    it('the repository counter is keyed on the session id it is given', async () => {
      // The real query, against a fake DataSource that keeps one counter per
      // `WHERE id = $1` parameter. A statement without that clause would bump
      // every session at once, which this catches.
      const counters: Record<string, number> = {};
      const queries: string[] = [];
      const dataSource = {
        createEntityManager: () => ({}),
        query: jest.fn(async (sql: string, params: string[]) => {
          queries.push(sql);
          if (!/WHERE id = \$1/.test(sql)) {
            Object.keys(counters).forEach((key) => (counters[key] += 1));
          }
          counters[params[0]] = (counters[params[0]] ?? 0) + 1;
          return [[{ lastRunSequence: counters[params[0]] }], 1];
        }),
      };
      const repository = new BuilderBuildRunRepository(dataSource as never);

      const [a1, b1, c1] = await Promise.all([
        repository.nextSequence('s1'),
        repository.nextSequence('s2'),
        repository.nextSequence('s3'),
      ]);
      const a2 = await repository.nextSequence('s1');

      expect([a1, b1, c1, a2]).toEqual([1, 1, 1, 2]);
      expect(queries.every((sql) => /WHERE id = \$1/.test(sql))).toBe(true);
    });
  });

  describe('assertWithinConcurrency', () => {
    beforeEach(() => {
      settings.maxConcurrentBuilds = 2;
    });

    it('counts active runs across sessions and refuses the (max+1)th', async () => {
      await start('s1');
      await start('s2');

      await expect(start('s3')).rejects.toThrow(/2 builds are already running/);
      // Refused before anything for s3 was written.
      expect(runs.filter((run) => run.sessionId === 's3')).toHaveLength(0);
      expect(sessions.get('s3')?.status).toBe(BuilderSessionStatus.PRD_READY);
    });

    it('counts a design run toward the ceiling, and a review run too', async () => {
      await design('s1');
      await start('s2');
      await expect(start('s3')).rejects.toBeInstanceOf(BadRequestException);

      // A review run is just as much a run holding capacity.
      runs.forEach((run) => (run.status = BuilderRunStatus.SUCCEEDED));
      addRun('s1', {
        mode: BuilderRunMode.REVIEW,
        status: BuilderRunStatus.RUNNING,
      });
      addRun('s2', {
        mode: BuilderRunMode.REVIEW,
        status: BuilderRunStatus.QUEUED,
      });
      await expect(design('s3')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('frees a slot when any session’s run finishes, whichever session started it', async () => {
      const first = await start('s1');
      await start('s2');
      await expect(start('s3')).rejects.toBeInstanceOf(BadRequestException);

      settle(first.id, BuilderRunStatus.SUCCEEDED);

      await expect(start('s3')).resolves.toBeDefined();
    });

    it('does not count runs parked on a question or already finished', async () => {
      addRun('s1', { status: BuilderRunStatus.WAITING_FOR_INPUT });
      addRun('s2', { status: BuilderRunStatus.FAILED });
      addRun('s2', { status: BuilderRunStatus.CANCELLED });

      await start('s1');
      await expect(start('s3')).resolves.toBeDefined();
    });

    it('a review run is skipped, not thrown, when the ceiling is full', async () => {
      await start('s1');
      await start('s2');
      const pullRequest = {
        id: 'pr-3',
        sessionId: 's3',
        repo: 'ally-be',
        branch: 'opencode/issue7-1',
        prNumber: 3,
        runId: 'run-x',
      };

      await expect(
        service.dispatchReviewRun(pullRequest, 'sha-3'),
      ).resolves.toBeNull();
      expect(github.dispatchWorkflow).not.toHaveBeenCalled();
    });

    // Was a known gap: the early ceiling check counts rows that are only saved
    // several awaits later, and the dispatch lock is per session, so a burst
    // of starts from different sessions all passed. dispatchRunLocked now
    // re-checks under a platform-wide slot lock while it creates the row.
    it('never lets a simultaneous burst of starts exceed the ceiling', async () => {
      const results = await Promise.allSettled([
        start('s1'),
        start('s2'),
        start('s3'),
      ]);

      const accepted = results.filter((r) => r.status === 'fulfilled');
      expect(accepted).toHaveLength(2);
      expect(
        activeIn([BuilderRunStatus.QUEUED, BuilderRunStatus.RUNNING]),
      ).toHaveLength(2);
    });

    it('takes a different dispatch lock per session, so sessions do not queue behind one another', async () => {
      await Promise.all([start('s1'), start('s2')]);

      const keys = redisService.acquireLock.mock.calls
        .map((call: string[]) => call[0])
        // The platform-wide run-slot lock is shared on purpose; the dispatch
        // lock is the per-session one.
        .filter((key: string) => key !== 'builder-run-slot');
      expect(new Set(keys).size).toBe(2);
      expect(keys[0]).toContain('s1');
      expect(keys[1]).toContain('s2');
    });

    it('still refuses a double start of the same session', async () => {
      redisService.acquireLock.mockImplementation(
        async (key: string) => !key.endsWith(':s1'),
      );

      await expect(start('s1')).rejects.toThrow(/already being started/);
      await expect(start('s2')).resolves.toBeDefined();
    });
  });

  describe('budget hold', () => {
    it('a session over its budget is refused without blocking another session', async () => {
      sessions.set(
        's1',
        sessionRow('s1', { budgetUsd: '10', totalCostUsd: '10.5' }),
      );

      await expect(design('s1')).rejects.toThrow(/budget/i);
      await expect(design('s2')).resolves.toBeDefined();
      await expect(start('s3')).resolves.toBeDefined();

      expect(runs.filter((run) => run.sessionId === 's1')).toHaveLength(0);
      expect(runs.map((run) => run.sessionId).sort()).toEqual(['s2', 's3']);
    });

    it('reads each session’s own spend, not a shared total', async () => {
      sessions.set(
        's1',
        sessionRow('s1', { budgetUsd: '10', totalCostUsd: '10' }),
      );
      // Same budget, well under it: must not inherit s1's spend.
      sessions.set(
        's2',
        sessionRow('s2', { budgetUsd: '10', totalCostUsd: '1' }),
      );

      await expect(design('s1')).rejects.toThrow(/budget/i);
      await expect(design('s2')).resolves.toBeDefined();
    });

    it('a review dispatch for a session at its budget does not stop another session’s review', async () => {
      // Reviews carry no per-session budget check (repo reviews run on the
      // target repo's Actions minutes). What matters here is that holding one
      // session does not hold the other.
      sessions.set(
        's1',
        sessionRow('s1', { budgetUsd: '10', totalCostUsd: '12' }),
      );
      const reviewOf = (sessionId: string, n: number) => ({
        id: `pr-${n}`,
        sessionId,
        repo: 'ally-be',
        branch: 'opencode/issue7-1',
        prNumber: n,
        runId: 'run-x',
      });
      pullRequests.set('pr-2', { id: 'pr-2', sessionId: 's2' });

      await expect(design('s1')).rejects.toThrow(/budget/i);
      const run = await service.dispatchReviewRun(reviewOf('s2', 2), 'sha-2');

      expect(run).toEqual(
        expect.objectContaining({ sessionId: 's2', sequence: 1 }),
      );
    });
  });

  describe('circuit breaker', () => {
    const failTwice = (sessionId: string) => {
      addRun(sessionId, { status: BuilderRunStatus.FAILED });
      addRun(sessionId, { status: BuilderRunStatus.FAILED });
    };
    const prFor = (sessionId: string, n: number) => ({
      id: `pr-${n}`,
      sessionId,
      repo: 'ally-be',
      branch: 'opencode/issue7-1',
      prNumber: n,
      runId: 'run-x',
    });

    it('trips for the session that failed, not for its neighbours', async () => {
      failTwice('s1');
      // s2 has a healthy history; s3 has one failure, below the limit.
      addRun('s2', { status: BuilderRunStatus.SUCCEEDED });
      addRun('s3', { status: BuilderRunStatus.FAILED });

      const [a, b, c] = await Promise.all([
        service.dispatchReviewRun(prFor('s1', 1), 'sha'),
        service.dispatchReviewRun(prFor('s2', 2), 'sha'),
        service.dispatchReviewRun(prFor('s3', 3), 'sha'),
      ]);

      expect(a).toBeNull();
      expect(b).toEqual(expect.objectContaining({ sessionId: 's2' }));
      expect(c).toEqual(expect.objectContaining({ sessionId: 's3' }));
      // Only the tripped session was announced, once.
      expect(notificationService.automationPaused).toHaveBeenCalledTimes(1);
      expect(notificationService.automationPaused).toHaveBeenCalledWith(
        expect.objectContaining({ id: 's1' }),
        2,
        // No run carries a createdAt in the fake; the real one is a Date.
        null,
      );
    });

    it('a success in another session does not clear a session’s failures', async () => {
      failTwice('s1');
      addRun('s2', { status: BuilderRunStatus.SUCCEEDED });
      addRun('s2', { status: BuilderRunStatus.SUCCEEDED });

      await expect(
        service.dispatchReviewRun(prFor('s1', 1), 'sha'),
      ).resolves.toBeNull();
    });

    it('failures in other sessions do not count toward this one', async () => {
      // Four failures in total across the platform, one in each of four
      // sessions; no single session is anywhere near the limit.
      sessions.set('s4', sessionRow('s4'));
      ['s1', 's2', 's3', 's4'].forEach((id) =>
        addRun(id, { status: BuilderRunStatus.FAILED }),
      );

      await expect(
        service.dispatchReviewRun(prFor('s1', 1), 'sha'),
      ).resolves.toEqual(expect.objectContaining({ sessionId: 's1' }));
    });
  });

  describe('pull request counters under reconcile', () => {
    let pullRequestService: BuilderPullRequestService;
    let remotes: Map<number, Row>;
    let feedbackRepository: Row;

    const opencodePr = (id: string, sessionId: string, n: number, extra = {}) =>
      ({
        id,
        sessionId,
        runId: `run-${id}`,
        repo: 'ally-be',
        branch: `opencode/issue${n}-1`,
        prNumber: n,
        prUrl: `https://github.com/org/ally-be/pull/${n}`,
        merged: false,
        state: 'open',
        ciStatus: 'success',
        headSha: null,
        fixRunCount: 0,
        reviewRunCount: 0,
        reviewedSha: null,
        reviewPassedSha: null,
        needsHumanAt: null,
        fixRequestedAt: null,
        fixRequestedSha: null,
        reviewHistory: [],
        ...extra,
      }) as Row;

    beforeEach(() => {
      remotes = new Map();
      feedbackRepository = {
        countPending: jest.fn().mockResolvedValue(0),
        countActionable: jest.fn().mockResolvedValue(0),
        listActionable: jest.fn().mockResolvedValue([]),
        upsertIfNew: jest.fn().mockResolvedValue(true),
        update: jest.fn(),
      };
      Object.assign(github, {
        getPullRequest: jest.fn(async (_repo: string, n: number) => ({
          merged: false,
          mergedAt: null,
          state: 'open',
          htmlUrl: `https://github.com/org/ally-be/pull/${n}`,
          headSha: `head-${n}`,
          mergeableState: 'clean',
          ...remotes.get(n),
        })),
        getCheckRollup: jest
          .fn()
          .mockResolvedValue({ state: 'success', failed: [], total: 1 }),
        failedCheckExcerpts: jest.fn().mockResolvedValue({}),
        listPullRequestFeedback: jest.fn().mockResolvedValue([]),
        listPullRequestFiles: jest
          .fn()
          .mockResolvedValue({ files: [], truncated: false }),
        getCommitAuthor: jest.fn().mockResolvedValue({
          login: 'ally-builder[bot]',
          name: 'Ally Builder',
          parents: ['p'],
        }),
        createIssueComment: jest.fn().mockResolvedValue('https://c/1'),
        updatePullRequestBranch: jest
          .fn()
          .mockResolvedValue({ updated: true, message: null }),
        credentialHealth: { failures: 0, since: null },
      });
      pullRequestService = new BuilderPullRequestService(
        pullRequestRepository as never,
        feedbackRepository as never,
        {
          ...sessionRepository,
          listRecentlyFailed: jest.fn().mockResolvedValue([]),
        } as never,
        {
          prsOpened: jest.fn(),
          prNeedsHuman: jest.fn(),
          prReadyToMerge: jest.fn(),
        } as never,
        { get: jest.fn(async () => settings) } as never,
        github as never,
        {} as never,
        { adminBaseUrl: 'https://admin.example.com' } as never,
        service as never,
      );
    });

    const seed = (...rows: Row[]) =>
      rows.forEach((row) => pullRequests.set(row.id, row));

    it('a review dispatched for one pull request moves only that row’s reviewRunCount', async () => {
      seed(
        opencodePr('pr-1', 's1', 11),
        // Already reviewed at its current head: nothing to do this tick.
        opencodePr('pr-2', 's2', 12, {
          reviewedSha: 'head-12',
          reviewRunCount: 1,
        }),
        opencodePr('pr-3', 's3', 13, {
          reviewedSha: 'head-13',
          reviewRunCount: 2,
        }),
      );
      // Their runs, so the review has a spec to read.
      addRun('s1', { id: 'run-pr-1' });

      await pullRequestService.reconcileOpenPullRequests();

      expect(pullRequests.get('pr-1')).toEqual(
        expect.objectContaining({ reviewRunCount: 1, reviewedSha: 'head-11' }),
      );
      expect(pullRequests.get('pr-2')?.reviewRunCount).toBe(1);
      expect(pullRequests.get('pr-3')?.reviewRunCount).toBe(2);
      expect(pullRequests.get('pr-2')?.fixRunCount).toBe(0);
      // The review run belongs to pr-1's session and to nobody else's.
      const reviews = runs.filter((run) => run.mode === BuilderRunMode.REVIEW);
      expect(reviews).toEqual([
        expect.objectContaining({ sessionId: 's1', pullRequestId: 'pr-1' }),
      ]);
    });

    it('three pull requests reviewed in one tick each count one review, in their own session', async () => {
      seed(
        opencodePr('pr-1', 's1', 11),
        opencodePr('pr-2', 's2', 12),
        opencodePr('pr-3', 's3', 13),
      );
      ['s1', 's2', 's3'].forEach((id, i) =>
        addRun(id, { id: `run-pr-${i + 1}` }),
      );

      await pullRequestService.reconcileOpenPullRequests();

      ['pr-1', 'pr-2', 'pr-3'].forEach((id) =>
        expect(pullRequests.get(id)?.reviewRunCount).toBe(1),
      );
      const reviews = runs.filter((run) => run.mode === BuilderRunMode.REVIEW);
      expect(
        reviews.map((run) => [run.sessionId, run.pullRequestId, run.sequence]),
      ).toEqual([
        ['s1', 'pr-1', 2],
        ['s2', 'pr-2', 2],
        ['s3', 'pr-3', 2],
      ]);
    });

    it('a pull request at its review ceiling does not stop another from being reviewed', async () => {
      seed(
        opencodePr('pr-1', 's1', 11, { reviewRunCount: 4 }),
        opencodePr('pr-2', 's2', 12),
      );
      addRun('s2', { id: 'run-pr-2' });

      await pullRequestService.reconcileOpenPullRequests();

      expect(pullRequests.get('pr-1')?.reviewRunCount).toBe(4);
      expect(pullRequests.get('pr-2')?.reviewRunCount).toBe(1);
    });

    it('a conflict fix request moves only that pull request’s fixRunCount', async () => {
      settings.autoReviewEnabled = false;
      seed(
        opencodePr('pr-1', 's1', 11),
        opencodePr('pr-2', 's2', 12),
        opencodePr('pr-3', 's3', 13),
      );
      // Only pr-2 conflicts with master.
      remotes.set(12, { mergeableState: 'dirty' });

      await pullRequestService.reconcileOpenPullRequests();

      expect(pullRequests.get('pr-2')).toEqual(
        expect.objectContaining({
          fixRunCount: 1,
          fixRequestedSha: 'head-12',
        }),
      );
      expect(pullRequests.get('pr-1')?.fixRunCount).toBe(0);
      expect(pullRequests.get('pr-3')?.fixRunCount).toBe(0);
      expect(pullRequests.get('pr-1')?.fixRequestedAt).toBeNull();
      expect(github.createIssueComment).toHaveBeenCalledTimes(1);
      expect(github.createIssueComment).toHaveBeenCalledWith(
        expect.anything(),
        12,
        expect.stringContaining('conflicts with master'),
      );
    });

    it('a feedback fix request moves only the pull request it was asked for', async () => {
      settings.autoReviewEnabled = false;
      seed(
        opencodePr('pr-1', 's1', 11),
        opencodePr('pr-2', 's2', 12),
        opencodePr('pr-3', 's3', 13),
      );
      // Only pr-3 has findings waiting.
      feedbackRepository.countPending.mockImplementation(async (id: string) =>
        id === 'pr-3' ? 2 : 0,
      );
      feedbackRepository.listActionable.mockImplementation(
        async (id: string) =>
          id === 'pr-3' ? [{ id: 'f1' }, { id: 'f2' }] : [],
      );

      await pullRequestService.reconcileOpenPullRequests();

      expect(pullRequests.get('pr-3')?.fixRunCount).toBe(1);
      expect(pullRequests.get('pr-1')?.fixRunCount).toBe(0);
      expect(pullRequests.get('pr-2')?.fixRunCount).toBe(0);
    });

    it('a session with a run in flight does not hold back another session’s fix request', async () => {
      settings.autoReviewEnabled = false;
      seed(opencodePr('pr-1', 's1', 11), opencodePr('pr-2', 's2', 12));
      addRun('s1', { status: BuilderRunStatus.RUNNING });
      feedbackRepository.countPending.mockResolvedValue(1);
      feedbackRepository.listActionable.mockResolvedValue([{ id: 'f1' }]);

      await pullRequestService.reconcileOpenPullRequests();

      expect(pullRequests.get('pr-1')?.fixRunCount).toBe(0);
      expect(pullRequests.get('pr-2')?.fixRunCount).toBe(1);
    });

    it('handing one pull request back to automation resets only its own counters', async () => {
      seed(
        opencodePr('pr-1', 's1', 11, { fixRunCount: 3, reviewRunCount: 4 }),
        opencodePr('pr-2', 's2', 12, { fixRunCount: 3, reviewRunCount: 4 }),
      );

      await pullRequestService.resumeAutomation('s1', 'pr-1', 1);

      expect(pullRequests.get('pr-1')).toEqual(
        expect.objectContaining({ fixRunCount: 0, reviewRunCount: 0 }),
      );
      expect(pullRequests.get('pr-2')).toEqual(
        expect.objectContaining({ fixRunCount: 3, reviewRunCount: 4 }),
      );
    });
  });
});
