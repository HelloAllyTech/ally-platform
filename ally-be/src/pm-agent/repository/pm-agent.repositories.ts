import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { PmAgentSettings } from '../entity/pm-agent-settings.entity';
import { PmAgentRun } from '../entity/pm-agent-run.entity';
import { PmAgentRunStep } from '../entity/pm-agent-run-step.entity';
import { PmAgentEvidence } from '../entity/pm-agent-evidence.entity';
import { PmAgentMemory } from '../entity/pm-agent-memory.entity';
import { PmAgentFeedback } from '../entity/pm-agent-feedback.entity';
import { PmAgentOutbox } from '../entity/pm-agent-outbox.entity';
import { PmAgentOutcome } from '../entity/pm-agent-outcome.entity';
import { PmAgentLaneStat } from '../entity/pm-agent-lane-stat.entity';
import { PmAgentSignal } from '../entity/pm-agent-signal.entity';
import {
  PmLaneStatDimension,
  PmMemoryKind,
  PmOutboxAction,
  PmOutboxStatus,
  PmOutboxStep,
  PmRunStatus,
} from '../enum/pm-agent.enum';
import { PM_OUTBOX_LOCK_MS } from '../constants/pm-agent.constants';

/** The singleton settings row (id = 1, seeded by the migration). */
@Injectable()
export class PmAgentSettingsRepository extends Repository<PmAgentSettings> {
  constructor(dataSource: DataSource) {
    super(PmAgentSettings, dataSource.createEntityManager());
  }

  /** The row, created OFF if a fresh database somehow lacks it. */
  async getSingleton(): Promise<PmAgentSettings> {
    const row = await this.findOne({ where: { id: 1 } });
    if (row) return row;
    await this.createQueryBuilder()
      .insert()
      .into(PmAgentSettings)
      .values({ id: 1 })
      .orIgnore()
      .execute();
    return this.findOneOrFail({ where: { id: 1 } });
  }

  async patch(patch: Partial<PmAgentSettings>): Promise<PmAgentSettings> {
    await this.update({ id: 1 }, patch);
    return this.getSingleton();
  }

  /**
   * Atomic failure counter for the circuit breaker: returns the new count. Never a
   * read-modify-write — two reconcile ticks counting the same failure twice is the
   * bug this avoids, so the caller only counts transitions it won.
   */
  async incrementBuildFailures(): Promise<number> {
    const rows: { consecutiveBuildFailures: number }[] = await this.query(
      `UPDATE "pm_agent_settings" SET "consecutiveBuildFailures" = "consecutiveBuildFailures" + 1,
              "updatedAt" = now()
        WHERE id = 1 RETURNING "consecutiveBuildFailures"`,
    );
    const row = Array.isArray(rows?.[0]) ? (rows[0] as any)[0] : rows?.[0];
    return Number(row?.consecutiveBuildFailures ?? 0);
  }

  async resetBuildFailures(): Promise<void> {
    await this.update({ id: 1 }, { consecutiveBuildFailures: 0 });
  }

  /** Trips the breaker once: true when this call is the one that paused it. */
  async tripBreaker(reason: string): Promise<boolean> {
    const result = await this.createQueryBuilder()
      .update(PmAgentSettings)
      .set({
        autoBuildPaused: true,
        autoBuildPausedReason: reason.slice(0, 300),
        autoBuildPausedAt: () => 'now()',
      })
      .where('id = 1')
      .andWhere('"autoBuildPaused" = false')
      .execute();
    return Boolean(result.affected);
  }
}

@Injectable()
export class PmAgentRunRepository extends Repository<PmAgentRun> {
  constructor(dataSource: DataSource) {
    super(PmAgentRun, dataSource.createEntityManager());
  }

  listRecent(limit: number): Promise<PmAgentRun[]> {
    return this.find({ order: { startedAt: 'DESC' }, take: limit });
  }

  findRunning(): Promise<PmAgentRun | null> {
    return this.findOne({ where: { status: PmRunStatus.RUNNING } });
  }

  findLast(): Promise<PmAgentRun | null> {
    return this.findOne({ where: {}, order: { startedAt: 'DESC' } });
  }

  /** Open reservations: what running runs have reserved but not yet spent. */
  async openReservationsUsd(): Promise<number> {
    const rows: { reserved: string | null }[] = await this.query(
      `SELECT COALESCE(SUM(GREATEST("reservedUsd" - "spentUsd", 0)), 0) AS reserved
         FROM "pm_agent_runs" WHERE status = $1::varchar`,
      [PmRunStatus.RUNNING],
    );
    return Number(rows?.[0]?.reserved ?? 0);
  }
}

@Injectable()
export class PmAgentRunStepRepository extends Repository<PmAgentRunStep> {
  constructor(dataSource: DataSource) {
    super(PmAgentRunStep, dataSource.createEntityManager());
  }

  async spendByLaneSince(
    since: Date,
  ): Promise<{ lane: string; costUsd: number }[]> {
    const rows: { lane: string; cost: string }[] = await this.query(
      `SELECT lane, COALESCE(SUM("costUsd"), 0) AS cost
         FROM "pm_agent_run_steps" WHERE "createdAt" >= $1::timestamp
        GROUP BY lane ORDER BY cost DESC`,
      [since],
    );
    return rows.map((row) => ({
      lane: row.lane,
      costUsd: Number(Number(row.cost).toFixed(4)),
    }));
  }
}

@Injectable()
export class PmAgentEvidenceRepository extends Repository<PmAgentEvidence> {
  constructor(dataSource: DataSource) {
    super(PmAgentEvidence, dataSource.createEntityManager());
  }

  listByIds(ids: string[]): Promise<PmAgentEvidence[]> {
    const valid = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(String(id ?? '')));
    if (!valid.length) return Promise.resolve([]);
    return this.find({ where: { id: In(valid) }, order: { fetchedAt: 'ASC' } });
  }
}

@Injectable()
export class PmAgentMemoryRepository extends Repository<PmAgentMemory> {
  constructor(dataSource: DataSource) {
    super(PmAgentMemory, dataSource.createEntityManager());
  }

  listAll(kind: PmMemoryKind, limit = 500): Promise<PmAgentMemory[]> {
    return this.find({
      where: { kind },
      order: { updatedAt: 'DESC' },
      take: limit,
    });
  }

  /** Writes a fact inside a caller's transaction (card decisions). */
  insertWith(
    manager: EntityManager,
    fact: Partial<PmAgentMemory>,
  ): Promise<unknown> {
    return manager.getRepository(PmAgentMemory).insert(fact);
  }
}

@Injectable()
export class PmAgentFeedbackRepository extends Repository<PmAgentFeedback> {
  constructor(dataSource: DataSource) {
    super(PmAgentFeedback, dataSource.createEntityManager());
  }

  insertWith(
    manager: EntityManager,
    row: Partial<PmAgentFeedback>,
  ): Promise<PmAgentFeedback> {
    const repo = manager.getRepository(PmAgentFeedback);
    return repo.save(repo.create(row));
  }
}

/**
 * The accept outbox. Rows are claimed with a conditional UPDATE that sets a lease
 * (`lockedUntil`), so two workers never run one row at once; a crashed worker's lease
 * expires and the row is retaken at the step it had reached.
 */
@Injectable()
export class PmAgentOutboxRepository extends Repository<PmAgentOutbox> {
  constructor(dataSource: DataSource) {
    super(PmAgentOutbox, dataSource.createEntityManager());
  }

  insertWith(
    manager: EntityManager,
    row: Partial<PmAgentOutbox>,
  ): Promise<unknown> {
    return manager.getRepository(PmAgentOutbox).insert({
      action: PmOutboxAction.BUILD,
      status: PmOutboxStatus.PENDING,
      step: PmOutboxStep.CREATE_SESSION,
      attempts: 0,
      ...row,
    });
  }

  /** Undo: the row goes only while it has not started. */
  deletePendingWith(
    manager: EntityManager,
    cardId: string,
  ): Promise<{ affected?: number | null }> {
    return manager.getRepository(PmAgentOutbox).delete({
      cardId,
      action: PmOutboxAction.BUILD,
      status: PmOutboxStatus.PENDING,
    });
  }

  findForCard(cardId: string): Promise<PmAgentOutbox | null> {
    return this.findOne({
      where: { cardId, action: PmOutboxAction.BUILD },
    });
  }

  /** Ids of rows due now and not leased. */
  async listDue(limit: number): Promise<string[]> {
    const rows: { id: string }[] = await this.query(
      `SELECT id FROM "pm_agent_outbox"
        WHERE status = ANY($1::varchar[]) AND "dueAt" <= now()
          AND ("lockedUntil" IS NULL OR "lockedUntil" < now())
        ORDER BY "dueAt" ASC LIMIT $2::int`,
      [[PmOutboxStatus.PENDING, PmOutboxStatus.WAITING], limit],
    );
    return rows.map((row) => row.id);
  }

  /** Lease one row. Null when another worker holds it or it is no longer due. */
  async claim(id: string): Promise<PmAgentOutbox | null> {
    const result = await this.createQueryBuilder()
      .update(PmAgentOutbox)
      .set({
        status: PmOutboxStatus.RUNNING,
        lockedUntil: () =>
          `now() + interval '${PM_OUTBOX_LOCK_MS} milliseconds'`,
        attempts: () => '"attempts" + 1',
      })
      .where('id = :id', { id })
      .andWhere('status IN (:...statuses)', {
        statuses: [PmOutboxStatus.PENDING, PmOutboxStatus.WAITING],
      })
      .andWhere('"dueAt" <= now()')
      .andWhere('("lockedUntil" IS NULL OR "lockedUntil" < now())')
      .returning('*')
      .execute();
    if (!result.affected) return null;
    return this.create((result.raw as PmAgentOutbox[])[0]);
  }

  /** Release the lease with the row's next state. */
  async settle(
    id: string,
    patch: Partial<
      Pick<
        PmAgentOutbox,
        'status' | 'step' | 'dueAt' | 'lastError' | 'attempts'
      >
    >,
  ): Promise<void> {
    await this.update({ id }, { ...patch, lockedUntil: null });
  }

  /** Retry: reopen the card's row at a step (creates it when there is none). */
  async reopen(
    cardId: string,
    step: PmOutboxStep,
    createdBy: number,
  ): Promise<void> {
    await this.query(
      `INSERT INTO "pm_agent_outbox" ("cardId", "action", "status", "step", "dueAt", "attempts", "createdBy")
       VALUES ($1::uuid, $2::varchar, $3::varchar, $4::varchar, now(), 0, $5::int)
       ON CONFLICT ("cardId", "action") DO UPDATE
         SET status = EXCLUDED.status, step = EXCLUDED.step, "dueAt" = now(),
             attempts = 0, "lastError" = NULL, "lockedUntil" = NULL, "updatedAt" = now()`,
      [cardId, PmOutboxAction.BUILD, PmOutboxStatus.PENDING, step, createdBy],
    );
  }
}

/** One learning row per decided card (UNIQUE cardId). */
@Injectable()
export class PmAgentOutcomeRepository extends Repository<PmAgentOutcome> {
  constructor(dataSource: DataSource) {
    super(PmAgentOutcome, dataSource.createEntityManager());
  }

  /** Insert or replace the decision half (a re-decision after undo overwrites). */
  async recordDecisionWith(
    manager: EntityManager,
    row: Partial<PmAgentOutcome> & { cardId: string },
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .insert()
      .into(PmAgentOutcome)
      .values(row)
      .orUpdate(
        [
          'decision',
          'decidedBy',
          'decidedAt',
          'decisionLatencyMs',
          'reasonChip',
          'feedbackChips',
          'undone',
          'impactMetricName',
        ],
        // The decision row is (cardId, 'decision', 0): the insert leaves kind/day to their
        // defaults, and the conflict target is the UNIQUE triple (migration 1982000000500).
        ['cardId', 'kind', 'day'],
      )
      .execute();
  }

  /** Outcome flags only move forward (false → true); never cleared by a later tick. */
  async flag(
    cardId: string,
    flags: Partial<
      Pick<
        PmAgentOutcome,
        | 'undone'
        | 'buildStarted'
        | 'buildFailed'
        | 'prOpened'
        | 'merged'
        | 'released'
        | 'reverted'
        | 'healthCheckFailed'
      >
    > & { buildCostUsd?: string | null; reasonChip?: string | null },
  ): Promise<void> {
    await this.update({ cardId, kind: 'decision' }, flags);
  }
}

/** Counters for selection learning; increments are atomic upserts. */
@Injectable()
export class PmAgentLaneStatRepository extends Repository<PmAgentLaneStat> {
  constructor(dataSource: DataSource) {
    super(PmAgentLaneStat, dataSource.createEntityManager());
  }

  async bump(
    dimension: PmLaneStatDimension,
    key: string,
    counter:
      | 'shown'
      | 'accepted'
      | 'rejected'
      | 'feedback'
      | 'shipped'
      | 'failed',
    by = 1,
  ): Promise<void> {
    // `counter` is a closed union, never user input, so interpolating the column is safe.
    await this.query(
      `INSERT INTO "pm_agent_lane_stats" ("dimension", "key", "${counter}")
       VALUES ($1::varchar, $2::varchar, $3::int)
       ON CONFLICT ("dimension", "key") DO UPDATE
         SET "${counter}" = "pm_agent_lane_stats"."${counter}" + EXCLUDED."${counter}",
             "updatedAt" = now()`,
      [dimension, key.slice(0, 64), by],
    );
  }
}

@Injectable()
export class PmAgentSignalRepository extends Repository<PmAgentSignal> {
  constructor(dataSource: DataSource) {
    super(PmAgentSignal, dataSource.createEntityManager());
  }
}
