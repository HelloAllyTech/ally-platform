import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import {
  CL_WORKER_CLAIM_STALE_MS,
  CL_WORKER_CONCURRENCY,
  CL_WORKER_MAX_ATTEMPTS,
} from '../constants/context-library.constants';
import {
  ClIngestSegment,
  ClSegmentRun,
} from '../entity/cl-ingest-segment.entity';
import { ClSource } from '../entity/cl-source.entity';
import {
  ClSegmentRunStatus,
  ClSegmentStatus,
  ClSourceStatus,
} from '../enum/context-library.enum';
import { ContextExtractionService } from './context-extraction.service';
import { ContextIndexService } from './context-index.service';
import { ContextStagingService } from './context-staging.service';
import { returningRows } from '../util/sql.util';

const BOOT_DELAY_MS = 30_000;

/**
 * Drains the extraction queue: one segment run (part × collection) at a time per slot.
 *
 * Postgres is the queue — `FOR UPDATE SKIP LOCKED` lets every ally-be replica drain it
 * without two claiming the same run — so there is no new SQS queue and no infra change.
 * Runs are taken in queue order (`queue_position`, then `ordinal`), so documents finish one
 * after another instead of all crawling along together; spare slots spill into the next
 * document. An upload kicks the drain at once; a five-minute tick picks work back up after a
 * deploy, and also pushes pending chunks to the index.
 */
@Injectable()
export class ContextWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = LoggerService.getInstance(
    ContextWorkerService.name,
  );
  private active = 0;
  private draining = false;
  private bootTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly extraction: ContextExtractionService,
    private readonly staging: ContextStagingService,
    private readonly index: ContextIndexService,
    @InjectRepository(ClSource) private readonly sources: Repository<ClSource>,
    @InjectRepository(ClIngestSegment)
    private readonly segments: Repository<ClIngestSegment>,
    @InjectRepository(ClSegmentRun)
    private readonly runs: Repository<ClSegmentRun>,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register(
      '5min',
      'context-library-drain',
      async () => {
        this.kick();
        await this.index.syncPending();
      },
    );
    this.bootTimer = setTimeout(() => {
      this.bootTimer = null;
      this.kick();
    }, BOOT_DELAY_MS);
    this.bootTimer.unref?.();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.bootTimer) clearTimeout(this.bootTimer);
  }

  /** Start draining in the background. Safe to call as often as you like. */
  kick(): void {
    if (this.draining || this.stopped) return;
    this.draining = true;
    this.drain()
      .catch((error) =>
        this.logger.warn(
          `Context Library drain stopped: ${(error as Error).message}`,
        ),
      )
      .finally(() => {
        this.draining = false;
      });
  }

  private async drain(): Promise<void> {
    const inFlight = new Set<Promise<void>>();
    for (;;) {
      if (this.stopped) break;
      while (inFlight.size < CL_WORKER_CONCURRENCY) {
        const run = await this.claim();
        if (!run) break;
        const task = this.processClaimed(run).finally(() =>
          inFlight.delete(task),
        );
        inFlight.add(task);
      }
      if (!inFlight.size) break;
      await Promise.race(inFlight);
    }
    await this.index.syncPending().catch(() => undefined);
  }

  /** Claim the next run, or null. Stale claims (a dead worker) are re-claimable. */
  async claim(): Promise<ClSegmentRun | null> {
    const result = await this.dataSource.query(
      `UPDATE "cl_segment_runs" r SET "status" = 'claimed', "claimed_at" = now(), "attempts" = r."attempts" + 1, "updatedAt" = now()
       WHERE r."id" = (
         SELECT r2."id" FROM "cl_segment_runs" r2
         JOIN "cl_sources" s ON s."id" = r2."source_id"
         WHERE (r2."status" = 'pending'
                OR (r2."status" = 'claimed' AND r2."claimed_at" < now() - ($1 || ' milliseconds')::interval))
           AND r2."attempts" < $2
           AND s."status" IN ('queued', 'extracting')
         ORDER BY r2."queue_position", r2."ordinal"
         FOR UPDATE OF r2 SKIP LOCKED
         LIMIT 1)
       RETURNING r."id"`,
      [String(CL_WORKER_CLAIM_STALE_MS), CL_WORKER_MAX_ATTEMPTS],
    );
    const id = returningRows<{ id: string }>(result)[0]?.id;
    return id ? this.runs.findOne({ where: { id } }) : null;
  }

  private async release(run: ClSegmentRun): Promise<void> {
    await this.runs.update(run.id, {
      status: ClSegmentRunStatus.PENDING,
      claimedAt: null,
      attempts: Math.max(0, run.attempts - 1),
    });
  }

  private async processClaimed(run: ClSegmentRun): Promise<void> {
    this.active++;
    try {
      const source = await this.sources.findOne({
        where: { id: run.sourceId },
      });
      const segment = await this.segments.findOne({
        where: { id: run.segmentId },
      });
      if (!source || !segment) {
        await this.runs.update(run.id, {
          status: ClSegmentRunStatus.FAILED,
          error: 'missing source or segment',
        });
        return;
      }
      if (source.status === ClSourceStatus.QUEUED) {
        await this.sources.update(source.id, {
          status: ClSourceStatus.EXTRACTING,
        });
      }
      const ready = await this.extraction.ensureOverview(source, (id) =>
        this.staging.get(id),
      );
      if (!ready) {
        // Another worker is writing this document's overview; hand the run back.
        await this.release(run);
        await new Promise((r) => setTimeout(r, 2000));
        return;
      }
      const staged = await this.staging.get(segment.id);
      if (!staged) {
        await this.extraction.markExpired(segment, run);
        await this.afterRun(run, source);
        return;
      }
      const result = await this.extraction.processRun(
        run,
        source,
        segment,
        staged,
      );
      await this.runs.update(run.id, {
        status: ClSegmentRunStatus.DONE,
        candidatesFound: result.found,
        candidatesKept: result.kept,
        outcomes: result.outcomes,
        error: null,
      });
      await this.extraction.enforceCostCap(source.id);
      await this.afterRun(run, source);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Context Library run ${run.id} failed (attempt ${run.attempts}): ${message}`,
      );
      const finalAttempt = run.attempts >= CL_WORKER_MAX_ATTEMPTS;
      await this.runs.update(run.id, {
        status: finalAttempt
          ? ClSegmentRunStatus.FAILED
          : ClSegmentRunStatus.PENDING,
        claimedAt: null,
        error: message.slice(0, 500),
      });
      if (finalAttempt) {
        const source = await this.sources.findOne({
          where: { id: run.sourceId },
        });
        if (source) await this.afterRun(run, source);
      }
    } finally {
      this.active--;
    }
  }

  /**
   * After a run reaches a final state: drop the segment's text once every collection has it,
   * and consolidate a collection once every one of its runs for the document is final.
   */
  private async afterRun(run: ClSegmentRun, source: ClSource): Promise<void> {
    const segmentOpen = await this.runs.count({
      where: [
        { segmentId: run.segmentId, status: ClSegmentRunStatus.PENDING },
        { segmentId: run.segmentId, status: ClSegmentRunStatus.CLAIMED },
      ],
    });
    if (!segmentOpen) {
      await this.staging.delete([run.segmentId]);
      await this.segments.update(
        { id: run.segmentId, status: ClSegmentStatus.PENDING },
        { status: ClSegmentStatus.DONE },
      );
    }
    const collectionOpen = await this.runs.count({
      where: [
        {
          sourceId: source.id,
          collectionId: run.collectionId,
          status: ClSegmentRunStatus.PENDING,
        },
        {
          sourceId: source.id,
          collectionId: run.collectionId,
          status: ClSegmentRunStatus.CLAIMED,
        },
      ],
    });
    if (!collectionOpen) {
      await this.extraction.consolidate(source.id, run.collectionId);
      await this.index.syncPending();
    }
  }

  get activeRuns(): number {
    return this.active;
  }
}
