import {
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ClRolloutStep } from '../../entity/cl-rollout-step.entity';
import {
  ClRolloutCorpus,
  ClRolloutStatus,
  ClRolloutStepKind,
} from '../../enum/context-library.enum';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import { KbImportStatus } from '../context-kb-import.service';
import {
  CL_ROLLOUT_TASK,
  ContextLibraryRolloutService,
  autoRolloutEnabled,
  backoffMs,
  failureReason,
  retireAfterHours,
} from '../context-library-rollout.service';

jest.mock('src/logger/logger.service', () => ({
  LoggerService: {
    getInstance: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  },
}));

const HOUR = 3_600_000;
const T0 = new Date('2026-11-10T08:00:00Z');

type Corpus = 'character_library' | 'ally_guide_library' | 'debrief_knowledge';

function importStatus(over: Partial<KbImportStatus> = {}): KbImportStatus {
  return {
    corpus: 'x',
    collectionId: 'y',
    documents: 3,
    importable: 3,
    archived: 0,
    withoutPassages: 0,
    notStarted: 0,
    inProgress: 0,
    complete: 3,
    withFailedParts: 0,
    importComplete: true,
    passages: 10,
    passagesCopied: 10,
    notServed: 0,
    enrichmentPending: 0,
    ...over,
  };
}

const smokeReport = (over: Record<string, unknown> = {}) => ({
  corpus: 'x',
  collectionId: 'y',
  useCase: 'ally_guide',
  windowDays: 30,
  logged: 12,
  replayed: 9,
  capped: false,
  answered: 7,
  inGaps: 2,
  unlabelled: 0,
  failed: 0,
  gaps: [{ label: 'Night shifts', queries: 2 }],
  passed: true,
  ...over,
});

const retireResult = (over: Record<string, unknown> = {}) => ({
  indexDropped: true,
  documentsDeleted: 3,
  passagesDeleted: 10,
  filesDeleted: 3,
  filesFailed: 0,
  retrievalLogsDeleted: 40,
  ...over,
});

function build(
  opts: {
    status?: Partial<Record<Corpus, Partial<KbImportStatus>>>;
    activeChunks?: number;
    migratedBefore?: boolean;
    locked?: boolean;
  } = {},
) {
  const rows: ClRolloutStep[] = [];
  let clock = T0;
  const status: Record<string, Partial<KbImportStatus>> = {
    character_library: {},
    ally_guide_library: {},
    debrief_knowledge: {},
    ...(opts.status ?? {}),
  };
  const repo = {
    find: jest.fn(async (options?: any) =>
      rows.filter(
        (r) => !options?.where?.corpus || r.corpus === options.where.corpus,
      ),
    ),
    save: jest.fn(async (row: ClRolloutStep) => row),
    createQueryBuilder: jest.fn(() => {
      const chain: any = {
        insert: () => chain,
        into: () => chain,
        orIgnore: () => chain,
        values: (values: Array<Partial<ClRolloutStep>>) => {
          for (const v of values) {
            if (!rows.some((r) => r.corpus === v.corpus && r.step === v.step)) {
              rows.push(
                Object.assign(new ClRolloutStep(), {
                  id: `${v.corpus}:${v.step}`,
                  corpus: v.corpus,
                  step: v.step,
                  status: ClRolloutStatus.PENDING,
                  attempts: 0,
                  startedAt: null,
                  finishedAt: null,
                  nextAttemptAt: null,
                  lastError: null,
                  detail: {},
                }),
              );
            }
          }
          return chain;
        },
        execute: async () => undefined,
      };
      return chain;
    }),
  };
  const dataSource = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes("status = 'active'")) {
        return [{ n: opts.activeChunks ?? 5 }];
      }
      if (sql.includes('EXISTS (SELECT 1 FROM cl_chunks')) {
        return [{ found: !!opts.migratedBefore }];
      }
      if (sql.includes('EXISTS (SELECT 1 FROM cl_sources')) {
        return [{ found: !!opts.migratedBefore }];
      }
      if (sql.includes('FROM cl_sources s')) return [{ id: 'src-1' }];
      return [];
    }),
  };
  const kbImport = {
    status: jest.fn(async (m: { corpus: Corpus }) =>
      importStatus(status[m.corpus]),
    ),
    import: jest.fn(async (_actor: unknown, m: { corpus: Corpus }) => ({
      ...importStatus({ ...status[m.corpus], inProgress: 3, notStarted: 0 }),
      queued: 3,
      alreadyImported: 0,
      noText: 0,
    })),
    retireConfirmed: jest.fn(async () => retireResult()),
  };
  const kbCopy = {
    startEnrichment: jest.fn(async () => ({ started: true, pending: 10 })),
    smokeCheck: jest.fn(async () => smokeReport()),
    smokeCheckDistilled: jest.fn(async () =>
      smokeReport({ useCase: 'character_interview' }),
    ),
  };
  const uploads = { retryFailed: jest.fn(async () => 2) };
  const redis = {
    acquireLock: jest.fn(async () => opts.locked ?? true),
    releaseLock: jest.fn(async () => undefined),
  };
  const service = new ContextLibraryRolloutService(
    repo as any,
    dataSource as any,
    kbImport as any,
    kbCopy as any,
    uploads as any,
    redis as any,
  );
  service.clock = () => clock;
  const row = (corpus: Corpus, step: ClRolloutStepKind) =>
    rows.find((r) => r.corpus === corpus && r.step === step)!;
  return {
    service,
    rows,
    row,
    status,
    kbImport,
    kbCopy,
    uploads,
    redis,
    dataSource,
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

const ENV_KEYS = [
  'CONTEXT_LIBRARY_AUTO_ROLLOUT',
  'CONTEXT_LIBRARY_RETIRE_AFTER_HOURS',
];

describe('ContextLibraryRolloutService', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  describe('settings', () => {
    it('is on unless switched off, and waits 24 hours unless told otherwise', () => {
      expect(autoRolloutEnabled({})).toBe(true);
      expect(autoRolloutEnabled({ CONTEXT_LIBRARY_AUTO_ROLLOUT: 'OFF' })).toBe(
        false,
      );
      expect(retireAfterHours({})).toBe(24);
      expect(
        retireAfterHours({ CONTEXT_LIBRARY_RETIRE_AFTER_HOURS: '0' }),
      ).toBe(0);
      expect(
        retireAfterHours({ CONTEXT_LIBRARY_RETIRE_AFTER_HOURS: '2.5' }),
      ).toBe(2.5);
      expect(
        retireAfterHours({ CONTEXT_LIBRARY_RETIRE_AFTER_HOURS: 'soon' }),
      ).toBe(24);
      expect(
        retireAfterHours({ CONTEXT_LIBRARY_RETIRE_AFTER_HOURS: '-1' }),
      ).toBe(24);
    });

    it('backs off from 5 minutes, doubling, to at most 6 hours', () => {
      expect(backoffMs(1)).toBe(5 * 60_000);
      expect(backoffMs(2)).toBe(10 * 60_000);
      expect(backoffMs(20)).toBe(6 * HOUR);
    });

    it('keeps our own refusals and reduces anything else to its class name', () => {
      expect(failureReason(new ConflictException('3 of 5 complete'))).toBe(
        '3 of 5 complete',
      );
      const leaky = new TypeError('could not parse "who do I call at night"');
      expect(failureReason(leaky)).toBe('TypeError');
    });
  });

  it('registers on the 5-minute interval and only starts a tick in the background', async () => {
    const { service, redis } = build();
    const before = scheduledTaskRegistry.getHandlers('5min').length;
    service.onModuleInit();
    const handlers = scheduledTaskRegistry.getHandlers('5min');
    expect(handlers.length).toBe(before + 1);
    const task = handlers[handlers.length - 1];
    expect(task.taskName).toBe(CL_ROLLOUT_TASK);
    let release!: () => void;
    redis.acquireLock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(false);
        }),
    );
    // The handler returns while the tick is still waiting on its lock.
    await expect(task.handler()).resolves.toBeUndefined();
    expect(service.start()).not.toBeNull();
    release();
    service.onModuleDestroy();
  });

  it('does nothing when switched off', async () => {
    process.env.CONTEXT_LIBRARY_AUTO_ROLLOUT = 'off';
    const { service, redis, rows } = build();
    expect(service.start()).toBeNull();
    await service.tick();
    expect(redis.acquireLock).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it('skips a tick while another replica holds the lock', async () => {
    const { service, rows, kbImport } = build({ locked: false });
    await service.tick();
    expect(rows).toHaveLength(0);
    expect(kbImport.status).not.toHaveBeenCalled();
  });

  it('creates one row per corpus and step', async () => {
    const { service, rows } = build();
    await service.tick();
    expect(rows.map((r) => `${r.corpus}:${r.step}`).sort()).toEqual(
      [
        'ally_guide_library:enrich',
        'ally_guide_library:retire',
        'ally_guide_library:smoke_check',
        'character_library:import',
        'character_library:retire',
        'character_library:smoke_check',
        'debrief_knowledge:enrich',
        'debrief_knowledge:retire',
        'debrief_knowledge:smoke_check',
      ].sort(),
    );
  });

  describe('character corpus', () => {
    it('imports, waits for the worker, smoke-checks, waits 24 hours, then retires', async () => {
      const t = build({
        status: {
          character_library: {
            importComplete: false,
            complete: 0,
            notStarted: 3,
          },
          // Nothing to migrate, so only the character corpus moves here.
          ally_guide_library: { documents: 0 },
          debrief_knowledge: { documents: 0 },
        },
      });
      await t.service.tick();
      expect(t.kbImport.import).toHaveBeenCalledTimes(1);
      const imp = t.row('character_library', ClRolloutStepKind.IMPORT);
      expect(imp.status).toBe(ClRolloutStatus.RUNNING);
      expect(imp.detail.queued).toBe(3);

      // The worker is distilling: wait, without importing again.
      t.status.character_library = {
        importComplete: false,
        complete: 1,
        inProgress: 2,
      };
      t.advance(5 * 60_000);
      await t.service.tick();
      expect(t.kbImport.import).toHaveBeenCalledTimes(1);
      expect(t.kbCopy.smokeCheckDistilled).not.toHaveBeenCalled();

      // Complete: the smoke check runs in the same tick; retirement waits.
      t.status.character_library = {};
      t.advance(5 * 60_000);
      await t.service.tick();
      expect(imp.status).toBe(ClRolloutStatus.DONE);
      expect(t.kbCopy.smokeCheckDistilled).toHaveBeenCalledTimes(1);
      const smoke = t.row('character_library', ClRolloutStepKind.SMOKE_CHECK);
      expect(smoke.status).toBe(ClRolloutStatus.DONE);
      expect(smoke.detail).toEqual({
        logged: 12,
        replayed: 9,
        answered: 7,
        inGaps: 2,
        unlabelled: 0,
        failed: 0,
        gapTopics: 1,
        capped: 0,
        passed: 1,
      });
      expect(t.kbImport.retireConfirmed).not.toHaveBeenCalled();

      const view = await t.service.view();
      const retireView = view.corpora[0].steps[2];
      expect(retireView.waitingUntil?.getTime()).toBe(
        smoke.finishedAt!.getTime() + 24 * HOUR,
      );

      t.advance(23 * HOUR);
      await t.service.tick();
      expect(t.kbImport.retireConfirmed).not.toHaveBeenCalled();

      t.advance(HOUR);
      await t.service.tick();
      expect(t.kbImport.retireConfirmed).toHaveBeenCalledTimes(1);
      const retire = t.row('character_library', ClRolloutStepKind.RETIRE);
      expect(retire.status).toBe(ClRolloutStatus.DONE);
      expect(retire.detail).toMatchObject({
        documentsDeleted: 3,
        retrievalLogsDeleted: 40,
        indexDropped: 1,
      });

      // Settled: later ticks leave it alone.
      t.advance(HOUR);
      await t.service.tick();
      expect(t.kbImport.retireConfirmed).toHaveBeenCalledTimes(1);
    });

    it('retires straight after the smoke check when the grace period is 0', async () => {
      process.env.CONTEXT_LIBRARY_RETIRE_AFTER_HOURS = '0';
      const t = build();
      await t.service.tick();
      expect(t.kbCopy.smokeCheckDistilled).toHaveBeenCalled();
      expect(t.kbImport.retireConfirmed).toHaveBeenCalledTimes(3);
      const order = [
        t.kbCopy.smokeCheckDistilled.mock.invocationCallOrder[0],
        t.kbImport.retireConfirmed.mock.invocationCallOrder[0],
      ];
      expect(order[0]).toBeLessThan(order[1]);
    });

    it('retries failed parts once nothing else is moving', async () => {
      const t = build({
        status: {
          character_library: {
            importComplete: false,
            complete: 2,
            withFailedParts: 1,
          },
        },
      });
      await t.service.tick();
      expect(t.uploads.retryFailed).toHaveBeenCalledWith('src-1');
      expect(t.kbImport.import).not.toHaveBeenCalled();
      expect(
        t.row('character_library', ClRolloutStepKind.IMPORT).detail
          .partsRetried,
      ).toBe(2);
    });
  });

  describe('copied corpora', () => {
    it('starts enrichment, leaves it while it moves, restarts it when it stalls', async () => {
      const t = build({
        status: {
          ally_guide_library: { enrichmentPending: 10 },
          debrief_knowledge: { enrichmentPending: 0 },
        },
      });
      await t.service.tick();
      expect(t.kbCopy.startEnrichment).toHaveBeenCalledTimes(1);
      const enrich = t.row('ally_guide_library', ClRolloutStepKind.ENRICH);
      expect(enrich.status).toBe(ClRolloutStatus.RUNNING);
      expect(enrich.attempts).toBe(1);

      // Falling: running somewhere, leave it.
      t.status.ally_guide_library = { enrichmentPending: 4 };
      t.advance(5 * 60_000);
      await t.service.tick();
      expect(t.kbCopy.startEnrichment).toHaveBeenCalledTimes(1);
      expect(enrich.attempts).toBe(0);
      expect(enrich.detail.pending).toBe(4);

      // Not falling: start it again (it resumes from what is still pending).
      t.advance(5 * 60_000);
      await t.service.tick();
      expect(t.kbCopy.startEnrichment).toHaveBeenCalledTimes(2);

      // Covered: the smoke check follows in the same tick.
      t.status.ally_guide_library = { enrichmentPending: 0 };
      t.advance(5 * 60_000);
      await t.service.tick();
      expect(enrich.status).toBe(ClRolloutStatus.DONE);
      expect(t.kbCopy.smokeCheck).toHaveBeenCalledTimes(2);
    });

    it('gives up after the attempt cap and picks up work a person finished', async () => {
      const t = build({
        status: {
          ally_guide_library: { enrichmentPending: 3 },
          debrief_knowledge: { enrichmentPending: 0 },
        },
      });
      t.kbCopy.startEnrichment.mockResolvedValue({ started: true, pending: 3 });
      for (let i = 0; i < 40; i++) {
        await t.service.tick();
        t.advance(6 * HOUR);
      }
      const enrich = t.row('ally_guide_library', ClRolloutStepKind.ENRICH);
      expect(t.kbCopy.startEnrichment).toHaveBeenCalledTimes(8);
      expect(enrich.status).toBe(ClRolloutStatus.FAILED);
      expect(enrich.nextAttemptAt).toBeNull();
      expect(enrich.lastError).toMatch(/3 passage/);

      t.status.ally_guide_library = { enrichmentPending: 0 };
      await t.service.tick();
      expect(enrich.status).toBe(ClRolloutStatus.DONE);
    });

    it('smoke-checks each corpus before retiring it', async () => {
      process.env.CONTEXT_LIBRARY_RETIRE_AFTER_HOURS = '0';
      const t = build();
      await t.service.tick();
      expect(t.kbCopy.smokeCheck).toHaveBeenCalledTimes(2);
      // Retirements in plan order: character, Ally guide, Debrief.
      const retires = t.kbImport.retireConfirmed.mock.invocationCallOrder;
      const smokes = t.kbCopy.smokeCheck.mock.invocationCallOrder;
      expect(smokes[0]).toBeLessThan(retires[1]);
      expect(smokes[1]).toBeLessThan(retires[2]);
      expect(
        t.kbCopy.smokeCheckDistilled.mock.invocationCallOrder[0],
      ).toBeLessThan(retires[0]);
    });
  });

  describe('retire gates', () => {
    beforeEach(() => {
      process.env.CONTEXT_LIBRARY_RETIRE_AFTER_HOURS = '0';
    });

    it('waits while the new collection has no active chunk', async () => {
      const t = build({ activeChunks: 0 });
      await t.service.tick();
      expect(t.kbImport.retireConfirmed).not.toHaveBeenCalled();
      const retire = t.row('debrief_knowledge', ClRolloutStepKind.RETIRE);
      expect(retire.status).toBe(ClRolloutStatus.PENDING);
      expect(retire.detail.activeChunks).toBe(0);
    });

    it('waits while the copy is incomplete', async () => {
      const t = build({
        status: {
          debrief_knowledge: { importComplete: false, complete: 2 },
        },
      });
      await t.service.tick();
      expect(t.kbImport.retireConfirmed).toHaveBeenCalledTimes(2);
      expect(
        t.row('debrief_knowledge', ClRolloutStepKind.RETIRE).attempts,
      ).toBe(0);
    });

    it('retries a failed retire with backoff, never throwing out of the tick', async () => {
      const t = build();
      t.kbImport.retireConfirmed.mockRejectedValue(
        new InternalServerErrorException(
          'Nothing was deleted: the old search index could not be dropped. Try again.',
        ),
      );
      await expect(t.service.tick()).resolves.toBeUndefined();
      const retire = t.row('character_library', ClRolloutStepKind.RETIRE);
      expect(retire.status).toBe(ClRolloutStatus.FAILED);
      expect(retire.attempts).toBe(1);
      expect(retire.lastError).toMatch(/could not be dropped/);
      const calls = t.kbImport.retireConfirmed.mock.calls.length;

      // Before the backoff: no new attempt.
      t.advance(60_000);
      await t.service.tick();
      expect(t.kbImport.retireConfirmed.mock.calls.length).toBe(calls);

      t.kbImport.retireConfirmed.mockResolvedValue(retireResult());
      t.advance(5 * 60_000);
      await t.service.tick();
      expect(retire.status).toBe(ClRolloutStatus.DONE);
      expect(retire.attempts).toBe(2);
    });

    it('keeps trying when stored files would not delete, summing what went', async () => {
      const t = build();
      t.kbImport.retireConfirmed.mockResolvedValueOnce(
        retireResult({ filesFailed: 1, documentsDeleted: 2 }),
      );
      await t.service.tick();
      const retire = t.row('character_library', ClRolloutStepKind.RETIRE);
      expect(retire.status).toBe(ClRolloutStatus.FAILED);
      t.advance(5 * 60_000);
      await t.service.tick();
      expect(retire.status).toBe(ClRolloutStatus.DONE);
      expect(retire.detail.documentsDeleted).toBe(5);
    });
  });

  describe('corpora with no old documents', () => {
    it('skips a corpus that never had any', async () => {
      const t = build({ status: { debrief_knowledge: { documents: 0 } } });
      await t.service.tick();
      const steps = t.rows.filter((r) => r.corpus === 'debrief_knowledge');
      expect(steps.every((r) => r.status === ClRolloutStatus.SKIPPED)).toBe(
        true,
      );
      expect(t.kbCopy.startEnrichment).not.toHaveBeenCalledWith(
        expect.objectContaining({ corpus: 'debrief_knowledge' }),
        expect.anything(),
      );
    });

    it('marks a corpus already retired by hand as done', async () => {
      const t = build({
        status: { ally_guide_library: { documents: 0 } },
        migratedBefore: true,
      });
      await t.service.tick();
      const steps = t.rows.filter((r) => r.corpus === 'ally_guide_library');
      expect(steps.every((r) => r.status === ClRolloutStatus.DONE)).toBe(true);
      expect(steps[0].detail.alreadyRetired).toBe(1);
    });
  });

  it('describes every step before the first tick, with no row written', async () => {
    const { service, rows } = build();
    const view = await service.view();
    expect(rows).toHaveLength(0);
    expect(view.automatic).toBe(true);
    expect(view.retireAfterHours).toBe(24);
    expect(view.corpora.map((c) => c.corpus)).toEqual([
      ClRolloutCorpus.CHARACTER_LIBRARY,
      ClRolloutCorpus.ALLY_GUIDE_LIBRARY,
      ClRolloutCorpus.DEBRIEF_KNOWLEDGE,
    ]);
    expect(view.corpora[0].steps.map((s) => s.step)).toEqual([
      'import',
      'smoke_check',
      'retire',
    ]);
    expect(view.corpora[1].steps[0]).toMatchObject({
      step: 'enrich',
      status: 'pending',
      detail: {},
      waitingUntil: null,
    });
  });
});
