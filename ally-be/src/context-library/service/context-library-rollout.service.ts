import {
  HttpException,
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import {
  CL_ROLLOUT_BACKOFF_BASE_MS,
  CL_ROLLOUT_BACKOFF_MAX_MS,
  CL_ROLLOUT_BOOT_DELAY_MS,
  CL_ROLLOUT_LOCK_TTL_SECONDS,
  CL_ROLLOUT_MAX_ATTEMPTS,
  CL_ROLLOUT_RETIRE_AFTER_HOURS_DEFAULT,
} from '../constants/context-library.constants';
import { ClRolloutStep } from '../entity/cl-rollout-step.entity';
import {
  ClRolloutCorpus,
  ClRolloutStatus,
  ClRolloutStepKind,
  ClSourceKind,
} from '../enum/context-library.enum';
import { ClActor } from './context-chunk.service';
import {
  ContextKbCopyService,
  SmokeCheckReport,
} from './context-kb-copy.service';
import {
  ALLY_GUIDE_CORPUS_MIGRATION,
  CHARACTER_CORPUS_MIGRATION,
  ContextKbImportService,
  DEBRIEF_CORPUS_MIGRATION,
  KbCorpusMigration,
  KbImportStatus,
  PASSAGE_SYNC_PREFIX,
} from './context-kb-import.service';
import { ContextUploadService } from './context-upload.service';

export const CL_ROLLOUT_TASK = 'context-library-rollout';
const LOCK_KEY = 'cl:rollout:tick';
/** A tick that starts a few seconds early still counts a step as due. */
const DUE_SLACK_MS = 30_000;

/**
 * The rollout acts for the platform: no user and no organisation, which the services' own
 * platform-admin guard accepts. Rows it writes (sources, chunk versions) carry no user.
 */
const SYSTEM_ACTOR: ClActor = { userId: null, tenantId: null };

export interface RolloutPlan {
  corpus: ClRolloutCorpus;
  migration: KbCorpusMigration;
  /** In order; a step starts only once every step before it is done. */
  steps: ClRolloutStepKind[];
}

/** Each retired corpus and its steps. A function, so nothing is built at module load. */
export function rolloutPlan(): RolloutPlan[] {
  const copied = [
    ClRolloutStepKind.ENRICH,
    ClRolloutStepKind.SMOKE_CHECK,
    ClRolloutStepKind.RETIRE,
  ];
  return [
    {
      corpus: ClRolloutCorpus.CHARACTER_LIBRARY,
      migration: CHARACTER_CORPUS_MIGRATION,
      steps: [
        ClRolloutStepKind.IMPORT,
        ClRolloutStepKind.SMOKE_CHECK,
        ClRolloutStepKind.RETIRE,
      ],
    },
    {
      corpus: ClRolloutCorpus.ALLY_GUIDE_LIBRARY,
      migration: ALLY_GUIDE_CORPUS_MIGRATION,
      steps: copied,
    },
    {
      corpus: ClRolloutCorpus.DEBRIEF_KNOWLEDGE,
      migration: DEBRIEF_CORPUS_MIGRATION,
      steps: copied,
    },
  ];
}

/** The kill switch: `CONTEXT_LIBRARY_AUTO_ROLLOUT=off` leaves every step to the manual routes. */
export function autoRolloutEnabled(env: NodeJS.ProcessEnv = process.env) {
  const value = (env.CONTEXT_LIBRARY_AUTO_ROLLOUT ?? '').trim().toLowerCase();
  return !['off', 'false', '0', 'no', 'disabled'].includes(value);
}

/** Hours between a corpus's smoke check and its retirement (`CONTEXT_LIBRARY_RETIRE_AFTER_HOURS`). */
export function retireAfterHours(env: NodeJS.ProcessEnv = process.env) {
  const raw = (env.CONTEXT_LIBRARY_RETIRE_AFTER_HOURS ?? '').trim();
  if (!raw) return CL_ROLLOUT_RETIRE_AFTER_HOURS_DEFAULT;
  const hours = Number(raw);
  return Number.isFinite(hours) && hours >= 0
    ? hours
    : CL_ROLLOUT_RETIRE_AFTER_HOURS_DEFAULT;
}

/** Wait before the next attempt, after `attempts` attempts: 5 min, doubling, at most 6 h. */
export function backoffMs(attempts: number): number {
  return Math.min(
    CL_ROLLOUT_BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1),
    CL_ROLLOUT_BACKOFF_MAX_MS,
  );
}

/**
 * Why a step failed, safe to store and log. The services' own refusals (HTTP exceptions) are
 * written by us and carry counts only; anything else is reduced to its class name, since a
 * driver's or a model client's message can echo the data it was handling.
 */
export function failureReason(error: unknown): string {
  if (error instanceof HttpException) return error.message.slice(0, 300);
  if (error instanceof Error) return (error.name || 'Error').slice(0, 80);
  return 'Unknown error';
}

function importCounts(status: KbImportStatus): Record<string, number> {
  return {
    documents: status.documents,
    importable: status.importable,
    complete: status.complete,
    inProgress: status.inProgress,
    notStarted: status.notStarted,
    withFailedParts: status.withFailedParts,
  };
}

function smokeCounts(report: SmokeCheckReport): Record<string, number> {
  return {
    logged: report.logged,
    replayed: report.replayed,
    answered: report.answered,
    inGaps: report.inGaps,
    unlabelled: report.unlabelled,
    failed: report.failed,
    gapTopics: report.gaps.length,
    capped: report.capped ? 1 : 0,
    passed: report.passed ? 1 : 0,
  };
}

const settled = (row: ClRolloutStep) =>
  row.status === ClRolloutStatus.DONE || row.status === ClRolloutStatus.SKIPPED;

export interface RolloutStepView {
  step: ClRolloutStepKind;
  status: ClRolloutStatus;
  attempts: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  nextAttemptAt: Date | null;
  lastError: string | null;
  detail: Record<string, number>;
  /** Retire only: the grace period after the smoke check ends then. */
  waitingUntil: Date | null;
}

export interface RolloutView {
  /** False when `CONTEXT_LIBRARY_AUTO_ROLLOUT=off`. */
  automatic: boolean;
  retireAfterHours: number;
  maxAttempts: number;
  corpora: Array<{
    corpus: ClRolloutCorpus;
    collectionId: string;
    steps: RolloutStepView[];
  }>;
}

/**
 * Carries each retired Knowledge Base corpus through what used to be manual admin steps after a
 * release (PLAN.md §6.5), with no one at a screen:
 *
 *  - **character_library**: start the import → wait until it reports complete → smoke check →
 *    retire.
 *  - **ally_guide_library**, **debrief_knowledge**: start enrichment of the copied passages
 *    (background; restarted when it stops moving) → wait until none is pending → smoke check →
 *    retire.
 *
 * Every step calls the same service method as its admin route; nothing here re-implements one.
 * Retirement runs only when its gates all hold — the import or copy is complete (the import
 * service's own guard, with only the confirmation phrase bypassed), this rollout's smoke check
 * for the corpus is done (it must come first: retiring deletes the retrieval logs it replays),
 * the new collection has an active chunk, and `CONTEXT_LIBRARY_RETIRE_AFTER_HOURS` (default 24)
 * have passed since that smoke check, so a release rolled back within a day still has the old
 * data. Otherwise it waits for a later tick.
 *
 * Progress is one `cl_rollout_steps` row per (corpus, step), so a restart or another replica
 * resumes it. Ticks come from the scheduler's 5-minute interval and once shortly after boot; the
 * handler only starts a tick in the background, so neither start-up, a request, nor the interval's
 * other tasks ever wait on it, and a Redis lock lets one replica tick at a time. A failed action
 * is retried with backoff up to `CL_ROLLOUT_MAX_ATTEMPTS`, then waits for a person; each tick
 * still checks the real state, so a step a person finishes by hand is picked up as done. A corpus
 * with no old documents is skipped, or marked done when an earlier copy shows it was retired by
 * hand. `CONTEXT_LIBRARY_AUTO_ROLLOUT=off` turns the whole thing off; the manual routes remain.
 *
 * Nothing it stores or logs holds a search's or a document's text: counts, step names and our
 * own refusal messages only.
 */
@Injectable()
export class ContextLibraryRolloutService
  implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = LoggerService.getInstance(
    ContextLibraryRolloutService.name,
  );
  private running: Promise<void> | null = null;
  private bootTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  /** Replaced in tests. */
  clock: () => Date = () => new Date();

  constructor(
    @InjectRepository(ClRolloutStep)
    private readonly steps: Repository<ClRolloutStep>,
    private readonly dataSource: DataSource,
    private readonly kbImport: ContextKbImportService,
    private readonly kbCopy: ContextKbCopyService,
    private readonly uploads: ContextUploadService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('5min', CL_ROLLOUT_TASK, async () => {
      this.start();
    });
  }

  onApplicationBootstrap(): void {
    this.bootTimer = setTimeout(() => {
      this.bootTimer = null;
      this.start();
    }, CL_ROLLOUT_BOOT_DELAY_MS);
    this.bootTimer.unref?.();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.bootTimer) clearTimeout(this.bootTimer);
  }

  /** Start a tick in the background unless one is running here. Never throws. */
  start(): Promise<void> | null {
    if (this.stopped || this.running || !autoRolloutEnabled()) {
      return this.running;
    }
    this.running = this.tick()
      .catch((error) =>
        this.logger.warn(
          `Context Library rollout tick did not run: ${failureReason(error)}`,
        ),
      )
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  /** One pass over every corpus, on one replica at a time. Exposed for tests. */
  async tick(): Promise<void> {
    if (!autoRolloutEnabled()) return;
    // A Redis failure means no tick, never an unguarded one: two replicas retiring at once is
    // the outcome this lock exists to prevent.
    const locked = await this.redis
      .acquireLock(LOCK_KEY, CL_ROLLOUT_LOCK_TTL_SECONDS)
      .catch(() => false);
    if (!locked) return;
    try {
      await this.ensureRows();
      for (const plan of rolloutPlan()) {
        if (this.stopped) break;
        try {
          await this.advance(plan);
        } catch (error) {
          this.logger.warn(
            `Context Library rollout: ${plan.corpus} did not advance this tick: ${failureReason(error)}`,
          );
        }
      }
    } finally {
      await this.redis.releaseLock(LOCK_KEY).catch(() => undefined);
    }
  }

  /** What `GET v1/context-library/rollout` returns. Reads only; creates no rows. */
  async view(): Promise<RolloutView> {
    const rows = await this.steps.find();
    const hours = retireAfterHours();
    const now = this.clock().getTime();
    return {
      automatic: autoRolloutEnabled(),
      retireAfterHours: hours,
      maxAttempts: CL_ROLLOUT_MAX_ATTEMPTS,
      corpora: rolloutPlan().map((plan) => {
        const own = rows.filter((r) => r.corpus === plan.corpus);
        const smoke = own.find((r) => r.step === ClRolloutStepKind.SMOKE_CHECK);
        const retireAt =
          smoke?.status === ClRolloutStatus.DONE && smoke.finishedAt
            ? smoke.finishedAt.getTime() + hours * 3_600_000
            : null;
        return {
          corpus: plan.corpus,
          collectionId: plan.migration.collectionId,
          steps: plan.steps.map((step) => {
            const row = own.find((r) => r.step === step);
            const waiting =
              step === ClRolloutStepKind.RETIRE &&
              retireAt !== null &&
              retireAt > now &&
              !(row && settled(row));
            return {
              step,
              status: row?.status ?? ClRolloutStatus.PENDING,
              attempts: row?.attempts ?? 0,
              startedAt: row?.startedAt ?? null,
              finishedAt: row?.finishedAt ?? null,
              nextAttemptAt: row?.nextAttemptAt ?? null,
              lastError: row?.lastError ?? null,
              detail: row?.detail ?? {},
              waitingUntil: waiting ? new Date(retireAt) : null,
            };
          }),
        };
      }),
    };
  }

  // ── One tick ────────────────────────────────────────────────────────────────

  private async ensureRows(): Promise<void> {
    const existing = await this.steps.find({ select: ['corpus', 'step'] });
    const have = new Set(existing.map((r) => `${r.corpus}:${r.step}`));
    const missing = rolloutPlan().flatMap((plan) =>
      plan.steps
        .filter((step) => !have.has(`${plan.corpus}:${step}`))
        .map((step) => ({ corpus: plan.corpus, step })),
    );
    if (!missing.length) return;
    await this.steps
      .createQueryBuilder()
      .insert()
      .into(ClRolloutStep)
      .values(missing)
      .orIgnore()
      .execute();
  }

  private async advance(plan: RolloutPlan): Promise<void> {
    const rows = await this.steps.find({ where: { corpus: plan.corpus } });
    const byStep = new Map(rows.map((r) => [r.step, r]));
    const ordered = plan.steps
      .map((step) => byStep.get(step))
      .filter((r): r is ClRolloutStep => Boolean(r));
    if (ordered.length < plan.steps.length || ordered.every(settled)) return;

    const status = await this.kbImport.status(plan.migration);
    if (status.documents === 0) {
      await this.settleWithoutDocuments(plan, ordered, byStep);
      return;
    }
    for (const row of ordered) {
      if (settled(row)) continue;
      const done = await this.runStep(plan, row, status, byStep);
      if (!done) break;
    }
  }

  /**
   * No old documents left. Either there never were any (skipped), or the corpus was already
   * retired — by this rollout's own retire step, or by hand before it got there (done).
   */
  private async settleWithoutDocuments(
    plan: RolloutPlan,
    ordered: ClRolloutStep[],
    byStep: Map<ClRolloutStepKind, ClRolloutStep>,
  ): Promise<void> {
    const retire = byStep.get(ClRolloutStepKind.RETIRE);
    const ourRetire = (retire?.attempts ?? 0) > 0;
    const retired = ourRetire || (await this.migratedBefore(plan.migration));
    const now = this.clock();
    for (const row of ordered) {
      if (settled(row)) continue;
      row.status = retired ? ClRolloutStatus.DONE : ClRolloutStatus.SKIPPED;
      row.finishedAt = now;
      row.nextAttemptAt = null;
      row.lastError = null;
      row.detail = {
        ...(row.detail ?? {}),
        oldDocuments: 0,
        ...(retired && !ourRetire ? { alreadyRetired: 1 } : {}),
      };
      await this.steps.save(row);
    }
    this.logger.info(
      `Context Library rollout: ${plan.corpus} has no old documents — ${
        retired ? 'already retired, marked done' : 'nothing to migrate, skipped'
      }`,
    );
  }

  /** Evidence that the corpus was carried over before its documents went. */
  private async migratedBefore(migration: KbCorpusMigration) {
    const [row]: Array<{ found: boolean }> =
      migration.mode === 'copy'
        ? await this.dataSource.query(
            `SELECT EXISTS (SELECT 1 FROM cl_chunks
                WHERE collection_id = $1 AND left(sync_key, length($2)) = $2) AS found`,
            [migration.collectionId, PASSAGE_SYNC_PREFIX],
          )
        : // Only the character corpus is distilled, so any `kb_migration` source is its own.
          await this.dataSource.query(
            `SELECT EXISTS (SELECT 1 FROM cl_sources WHERE kind = $1) AS found`,
            [ClSourceKind.KB_MIGRATION],
          );
    return Boolean(row?.found);
  }

  /** True when the step is done and the next one may start in this tick. */
  private runStep(
    plan: RolloutPlan,
    row: ClRolloutStep,
    status: KbImportStatus,
    byStep: Map<ClRolloutStepKind, ClRolloutStep>,
  ): Promise<boolean> {
    switch (row.step) {
      case ClRolloutStepKind.IMPORT:
        return this.importStep(plan, row, status);
      case ClRolloutStepKind.ENRICH:
        return this.enrichStep(plan, row, status);
      case ClRolloutStepKind.SMOKE_CHECK:
        return this.smokeCheckStep(plan, row);
      case ClRolloutStepKind.RETIRE:
        return this.retireStep(plan, row, status, byStep);
      default:
        return Promise.resolve(false);
    }
  }

  // ── Steps ───────────────────────────────────────────────────────────────────

  /**
   * Character corpus: queue whatever has no live source (the import skips the rest), retry
   * failed parts once nothing else is moving, and otherwise wait for the worker.
   */
  private async importStep(
    plan: RolloutPlan,
    row: ClRolloutStep,
    status: KbImportStatus,
  ): Promise<boolean> {
    const detail = importCounts(status);
    if (status.importComplete) return this.finish(row, detail);
    if (
      typeof row.detail?.complete === 'number' &&
      status.complete > row.detail.complete
    ) {
      row.attempts = 0;
    }
    const stuck = status.inProgress === 0 && status.withFailedParts > 0;
    if (status.notStarted > 0 || stuck) {
      if (!this.canAttempt(row)) return this.keep(row, detail);
      await this.begin(row, detail);
      try {
        if (status.notStarted > 0) {
          const result = await this.kbImport.import(
            SYSTEM_ACTOR,
            plan.migration,
          );
          const counts = { ...importCounts(result), queued: result.queued };
          if (!result.queued && result.notStarted > 0) {
            return this.fail(
              row,
              `${result.notStarted} document(s) could not be queued: no text to distil.`,
              counts,
            );
          }
          row.detail = counts;
        } else {
          const retried = await this.retryFailedParts();
          if (!retried) {
            return this.fail(
              row,
              `${status.withFailedParts} document(s) have failed parts that could not be retried.`,
              detail,
            );
          }
          row.detail = { ...detail, partsRetried: retried };
        }
        row.lastError = null;
        await this.steps.save(row);
      } catch (error) {
        return this.fail(row, failureReason(error), detail);
      }
      return false;
    }
    // The worker is distilling (or a document is paused at its cost cap): wait.
    row.status = ClRolloutStatus.RUNNING;
    return this.keep(row, detail);
  }

  /** The parts of imported documents that failed, back in the queue (the Library's Retry). */
  private async retryFailedParts(): Promise<number> {
    const sources: Array<{ id: string }> = await this.dataSource.query(
      `SELECT s.id FROM cl_sources s
        WHERE s.kind = $1 AND s.status = 'complete'
          AND EXISTS (SELECT 1 FROM cl_segment_runs r
                       WHERE r.source_id = s.id AND r.status = 'failed')`,
      [ClSourceKind.KB_MIGRATION],
    );
    let retried = 0;
    for (const source of sources) {
      retried += await this.uploads.retryFailed(source.id);
    }
    return retried;
  }

  /**
   * Copied corpora: enrichment runs in the background. While the pending count keeps falling,
   * leave it be (it may be running on another replica); when it stops falling with chunks still
   * pending — it finished with failures, or a restart cut it off — start it again.
   */
  private async enrichStep(
    plan: RolloutPlan,
    row: ClRolloutStep,
    status: KbImportStatus,
  ): Promise<boolean> {
    const pending = status.enrichmentPending ?? 0;
    const detail = {
      passages: status.passages ?? 0,
      passagesCopied: status.passagesCopied ?? 0,
      pending,
    };
    if (pending === 0) return this.finish(row, detail);

    const last = row.detail?.pending;
    if (typeof last === 'number' && pending < last) {
      row.status = ClRolloutStatus.RUNNING;
      row.attempts = 0;
      row.nextAttemptAt = null;
      row.lastError = null;
      return this.keep(row, detail);
    }
    if (row.attempts > 0 && row.status === ClRolloutStatus.RUNNING) {
      row.status = ClRolloutStatus.FAILED;
      row.lastError = `Enrichment stopped with ${pending} passage(s) still waiting.`;
      this.logger.warn(
        `Context Library rollout: ${row.corpus} enrichment stopped with ${pending} passage(s) ` +
          `still waiting (attempt ${row.attempts}/${CL_ROLLOUT_MAX_ATTEMPTS})`,
      );
    }
    if (!this.canAttempt(row)) {
      if (this.exhausted(row)) row.nextAttemptAt = null;
      return this.keep(row, detail);
    }
    await this.begin(row, detail);
    try {
      const result = await this.kbCopy.startEnrichment(
        plan.migration,
        SYSTEM_ACTOR,
      );
      row.detail = { ...detail, pending: result.pending };
      await this.steps.save(row);
    } catch (error) {
      return this.fail(row, failureReason(error), detail);
    }
    return false;
  }

  private async smokeCheckStep(
    plan: RolloutPlan,
    row: ClRolloutStep,
  ): Promise<boolean> {
    if (this.inFlight(row)) return false;
    this.markInterrupted(row);
    if (!this.canAttempt(row)) return this.keep(row, row.detail ?? {});
    await this.begin(row, row.detail ?? {});
    let report: SmokeCheckReport;
    try {
      report =
        plan.migration.mode === 'copy'
          ? await this.kbCopy.smokeCheck(plan.migration, SYSTEM_ACTOR)
          : await this.kbCopy.smokeCheckDistilled(plan.migration, SYSTEM_ACTOR);
    } catch (error) {
      return this.fail(row, failureReason(error));
    }
    const detail = smokeCounts(report);
    if (report.replayed > 0 && report.failed === report.replayed) {
      return this.fail(
        row,
        'Every replayed search failed, so the check says nothing yet.',
        detail,
      );
    }
    return this.finish(row, detail);
  }

  private async retireStep(
    plan: RolloutPlan,
    row: ClRolloutStep,
    status: KbImportStatus,
    byStep: Map<ClRolloutStepKind, ClRolloutStep>,
  ): Promise<boolean> {
    const smoke = byStep.get(ClRolloutStepKind.SMOKE_CHECK);
    if (smoke?.status !== ClRolloutStatus.DONE || !smoke.finishedAt) {
      return false;
    }
    const [{ n } = { n: 0 }]: Array<{ n: number | string }> =
      await this.dataSource.query(
        `SELECT COUNT(*)::int AS n FROM cl_chunks
          WHERE collection_id = $1 AND status = 'active'`,
        [plan.migration.collectionId],
      );
    const deleted = (key: string) => Number(row.detail?.[key] ?? 0);
    const detail: Record<string, number> = {
      ...(row.detail ?? {}),
      activeChunks: Number(n),
      importable: status.importable,
      complete: status.complete,
    };

    const retireAt =
      smoke.finishedAt.getTime() + retireAfterHours() * 3_600_000;
    if (this.clock().getTime() < retireAt) return this.keep(row, detail);
    // The import service refuses an incomplete import or copy too; checking first keeps a wait
    // from being counted as a failed attempt.
    if (!status.importComplete || !Number(n)) return this.keep(row, detail);
    if (this.inFlight(row)) return false;
    this.markInterrupted(row);
    if (!this.canAttempt(row)) return this.keep(row, detail);

    await this.begin(row, detail);
    try {
      const result = await this.kbImport.retireConfirmed(
        SYSTEM_ACTOR,
        plan.migration,
      );
      // Summed: a retry after files that would not delete finishes what the first attempt began.
      const counts = {
        ...detail,
        documentsDeleted: deleted('documentsDeleted') + result.documentsDeleted,
        passagesDeleted: deleted('passagesDeleted') + result.passagesDeleted,
        filesDeleted: deleted('filesDeleted') + result.filesDeleted,
        filesFailed: result.filesFailed,
        retrievalLogsDeleted:
          deleted('retrievalLogsDeleted') + result.retrievalLogsDeleted,
        indexDropped: result.indexDropped ? 1 : deleted('indexDropped'),
      };
      if (result.filesFailed > 0) {
        return this.fail(
          row,
          `${result.filesFailed} stored file(s) could not be deleted; their documents were kept for the next attempt.`,
          counts,
        );
      }
      return this.finish(row, counts);
    } catch (error) {
      return this.fail(row, failureReason(error), detail);
    }
  }

  // ── Step state ──────────────────────────────────────────────────────────────

  private exhausted(row: ClRolloutStep): boolean {
    return row.attempts >= CL_ROLLOUT_MAX_ATTEMPTS;
  }

  private canAttempt(row: ClRolloutStep): boolean {
    if (this.exhausted(row)) return false;
    return (
      !row.nextAttemptAt ||
      row.nextAttemptAt.getTime() <= this.clock().getTime() + DUE_SLACK_MS
    );
  }

  /** A synchronous step started recently enough that another tick may still be running it. */
  private inFlight(row: ClRolloutStep): boolean {
    return (
      row.status === ClRolloutStatus.RUNNING &&
      !!row.startedAt &&
      this.clock().getTime() - row.startedAt.getTime() <
        CL_ROLLOUT_LOCK_TTL_SECONDS * 1000
    );
  }

  /** A synchronous step still `running` past the lock's lifetime was cut off by a restart. */
  private markInterrupted(row: ClRolloutStep): void {
    if (row.status !== ClRolloutStatus.RUNNING) return;
    row.status = ClRolloutStatus.FAILED;
    row.lastError = 'Interrupted by a restart.';
  }

  private async begin(
    row: ClRolloutStep,
    detail: Record<string, number>,
  ): Promise<void> {
    const now = this.clock();
    row.status = ClRolloutStatus.RUNNING;
    row.attempts += 1;
    row.startedAt = now;
    row.finishedAt = null;
    row.nextAttemptAt = new Date(now.getTime() + backoffMs(row.attempts));
    row.detail = detail;
    await this.steps.save(row);
    this.logger.info(
      `Context Library rollout: ${row.corpus} ${row.step} started (attempt ${row.attempts}/${CL_ROLLOUT_MAX_ATTEMPTS})`,
    );
  }

  private async keep(
    row: ClRolloutStep,
    detail: Record<string, number>,
  ): Promise<false> {
    row.detail = detail;
    await this.steps.save(row);
    return false;
  }

  private async finish(
    row: ClRolloutStep,
    detail: Record<string, number>,
  ): Promise<true> {
    const now = this.clock();
    row.status = ClRolloutStatus.DONE;
    row.startedAt = row.startedAt ?? now;
    row.finishedAt = now;
    row.nextAttemptAt = null;
    row.lastError = null;
    row.detail = detail;
    await this.steps.save(row);
    this.logger.info(
      `Context Library rollout: ${row.corpus} ${row.step} done (${Object.entries(
        detail,
      )
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')})`,
    );
    return true;
  }

  private async fail(
    row: ClRolloutStep,
    reason: string,
    detail?: Record<string, number>,
  ): Promise<false> {
    row.status = ClRolloutStatus.FAILED;
    row.lastError = reason.slice(0, 300);
    if (this.exhausted(row)) row.nextAttemptAt = null;
    if (detail) row.detail = detail;
    await this.steps.save(row);
    this.logger.warn(
      `Context Library rollout: ${row.corpus} ${row.step} failed (attempt ${row.attempts}/${CL_ROLLOUT_MAX_ATTEMPTS}` +
        `${this.exhausted(row) ? ', waiting for a person' : ''}): ${row.lastError}`,
    );
    return false;
  }
}
