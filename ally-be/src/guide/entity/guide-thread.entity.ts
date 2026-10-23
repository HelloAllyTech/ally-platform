import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { GuideMode, GuideThreadStatus } from '../enum/guide.enum';

/** Pacing counters the Conductor keeps per thread (plan §4.4). */
export interface GuideThreadPacing {
  offSpineTurns?: number;
  releaseWindowUntilTurn?: number | null;
  fadeLevel?: number;
  lastSteerAt?: string | null;
  steerDeclinedAt?: string | null;
  sideQuestsSinceItem?: number;
  firstWinAt?: string | null;
}

/** What the current epoch's frozen context prefix was built from (plan §7.6). */
export interface GuideEpochSnapshot {
  releaseId?: string | null;
  model?: string | null;
  layerHashes?: Record<string, string>;
  startedAt?: string;
  reason?: string;
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
