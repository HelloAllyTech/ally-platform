import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { MANUAL_RUN_ADVISORY_LOCK } from '../constants/manual-agent.constants';
import {
  ManualRun,
  ManualRunItemOutcome,
  ManualRunStatus,
} from '../entity/manual-run.entity';

export type ManualRunTrigger = 'scheduled' | 'manual';

/**
 * The `manual_runs` rows of the weekly agent. At most one `running` row exists: starting a run takes
 * a transaction-scoped advisory lock (two replicas, or a run-now racing the tick, serialise on it),
 * then inserts the row, and the partial unique index `uq_manual_runs_one_running` refuses a second
 * running row if anything slips past the lock.
 */
@Injectable()
export class ManualRunService {
  constructor(
    @InjectRepository(ManualRun)
    private readonly runs: Repository<ManualRun>,
    private readonly dataSource: DataSource,
  ) {}

  /** A new `running` row, or null when another run holds the lock or is already running. */
  async begin(
    trigger: ManualRunTrigger,
    triggeredBy: number | null,
    reservedUsd: number,
  ): Promise<ManualRun | null> {
    try {
      return await this.dataSource.transaction(async (em) => {
        const [{ locked }] = await em.query(
          'SELECT pg_try_advisory_xact_lock($1) AS locked',
          [MANUAL_RUN_ADVISORY_LOCK],
        );
        if (!locked) return null;
        const running = await em.getRepository(ManualRun).count({
          where: { status: 'running' },
        });
        if (running) return null;
        return em.getRepository(ManualRun).save(
          em.getRepository(ManualRun).create({
            trigger,
            status: 'running',
            triggeredBy,
            reservedUsd: reservedUsd.toFixed(4),
            spentUsd: '0',
          }),
        );
      });
    } catch (error) {
      if ((error as { code?: string })?.code === '23505') return null;
      throw error;
    }
  }

  async recordSkipped(
    trigger: ManualRunTrigger,
    triggeredBy: number | null,
    stopReason: string,
    summary: string,
  ): Promise<ManualRun> {
    const now = new Date();
    return this.runs.save(
      this.runs.create({
        trigger,
        status: 'skipped',
        stopReason,
        summary,
        triggeredBy,
        reservedUsd: '0',
        spentUsd: '0',
        startedAt: now,
        finishedAt: now,
      }),
    );
  }

  /** Keep the row's spend current, so the month's open reservation shrinks as the run spends. */
  async progress(
    id: string,
    patch: {
      spentUsd: number;
      pagesTouched: number;
      proposalsApplied: number;
      itemLog?: ManualRunItemOutcome[];
    },
  ): Promise<void> {
    await this.runs.update(id, {
      spentUsd: patch.spentUsd.toFixed(4),
      pagesTouched: patch.pagesTouched,
      proposalsApplied: patch.proposalsApplied,
      ...(patch.itemLog ? { itemLog: patch.itemLog } : {}),
    });
  }

  async finish(
    id: string,
    patch: {
      status: Exclude<ManualRunStatus, 'running'>;
      stopReason?: string | null;
      spentUsd: number;
      pagesTouched: number;
      proposalsApplied: number;
      summary?: string | null;
      error?: string | null;
      itemLog?: ManualRunItemOutcome[];
    },
  ): Promise<void> {
    await this.runs.update(id, {
      status: patch.status,
      stopReason: patch.stopReason ?? null,
      spentUsd: patch.spentUsd.toFixed(4),
      // The run is over: nothing of its reservation stays open against the month.
      reservedUsd: patch.spentUsd.toFixed(4),
      pagesTouched: patch.pagesTouched,
      proposalsApplied: patch.proposalsApplied,
      summary: patch.summary ?? null,
      error: patch.error ? patch.error.slice(0, 2000) : null,
      ...(patch.itemLog ? { itemLog: patch.itemLog } : {}),
      finishedAt: new Date(),
    });
  }

  /**
   * Claim this IST week for the scheduled run: sets `last_run_date` to `today` only when it is
   * before `weekStart` (this week's Monday). One replica wins; the rest see no row and skip.
   */
  async claimWeek(today: string, weekStart: string): Promise<boolean> {
    const rows: unknown[] = await this.dataSource.query(
      `UPDATE manual_settings
          SET last_run_date = $1::date
        WHERE id = 1 AND (last_run_date IS NULL OR last_run_date < $2::date)
        RETURNING id`,
      [today, weekStart],
    );
    // TypeORM's postgres driver returns [rows, count] for an UPDATE … RETURNING.
    const returned = Array.isArray(rows[0]) ? (rows[0] as unknown[]) : rows;
    return returned.length > 0;
  }
}
