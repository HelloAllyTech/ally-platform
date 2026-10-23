import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { GuideMode, GuideThreadStatus } from '../enum/guide.enum';

/** Pacing counters the Conductor keeps per thread (plan §4.4). */
/**
 * The pacing director's memory for one thread (plans/ally-guide/plan.md §4.4).
 * Counted in learner turns rather than wall-clock time wherever the rule is
 * about conversation rhythm, so a learner who steps away is not "steered"
 * on return. Read and written only through `src/guide/conductor/pacing.ts`.
 */
export interface GuideThreadPacing {
  /** Learner turns in this thread so far. */
  learnerTurns?: number;
  /** Learner turns since the last progress or item interaction. */
  offSpineTurns?: number;
  /** ISO time of the last item opened or completed. */
  lastProgressAt?: string | null;
  /** Open after a high-tension item: Ally listens, nothing steers. */
  releaseWindow?: { itemId: string; openedAtTurn: number } | null;
  /** `learnerTurns` when Ally last bridged back to the course out loud. */
  lastVerbalSteerTurn?: number | null;
  /** `learnerTurns` when the learner last said "not now". */
  declinedAtTurn?: number | null;
  /** 1.0 talks most; falls toward the floor as competence shows. */
  fadeLevel?: number;
  /** ISO time of the learner's first win in this course. */
  firstWinAt?: string | null;
}

/** What the current epoch's frozen context prefix was built from (plan §7.6). */
export interface GuideEpochSnapshot {
  releaseId?: string | null;
  model?: string | null;
  /** Budget tier the epoch's model was chosen for. */
  tier?: 'premium' | 'degraded' | 'lite';
  layerHashes?: Record<string, string>;
  startedAt?: string;
  reason?: string;
  /** Seq of the epoch's first learner message: history replays from here. */
  startSeq?: number;
  /** The latest emergency rollback when the epoch began (audit id). */
  emergencyRollbackId?: string | null;
}

/**
 * One learner's — or one anonymous visitor's — conversation with Ally for one
 * course (plan §1 "Thread"). `tenantId` is null until a visitor thread is
 * claimed. One ACTIVE thread per (user, tenant, track) — partial unique index
 * `uq_guide_threads_active_user_track`.
 */
@Entity('guide_threads')
export class GuideThread extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int', nullable: true })
  userId?: number | null;

  @Column({ type: 'uuid', nullable: true })
  visitorId?: string | null;

  @Column({ type: 'uuid' })
  trackId!: string;

  @Column({ type: 'uuid', nullable: true })
  trackEnrollmentId?: string | null;

  @Column({ type: 'varchar', length: 16, default: GuideThreadStatus.ACTIVE })
  status!: GuideThreadStatus;

  @Column({ type: 'varchar', length: 20, default: GuideMode.NORMAL })
  mode!: GuideMode;

  @Column({ type: 'timestamp', nullable: true })
  modeChangedAt?: Date | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  languageCode?: string | null;

  @Column({ type: 'int', default: 0 })
  epoch!: number;

  @Column({ type: 'jsonb', nullable: true })
  epochSnapshot?: GuideEpochSnapshot | null;

  @Column({ type: 'uuid', nullable: true })
  releaseId?: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  arm?: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 6, default: 0 })
  costUsd!: string;

  @Column({ type: 'int', default: 0 })
  lastMessageSeq!: number;

  @Column({ type: 'int', default: 0 })
  lastEventSeq!: number;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  pacing!: GuideThreadPacing;

  @Column({ type: 'timestamp', nullable: true })
  lastLearnerActivityAt?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  mergedIntoThreadId?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt?: Date | null;

  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId?: string | null;
}
