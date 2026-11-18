import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import {
  ClRolloutCorpus,
  ClRolloutStatus,
  ClRolloutStepKind,
} from '../enum/context-library.enum';

/**
 * One step of the automatic rollout that follows a release (`ContextLibraryRolloutService`):
 * one row per (corpus, step), so progress survives restarts and is shared by every replica.
 *
 * `detail` holds counts only (documents, passages, replayed searches, deleted rows) — never a
 * search's text, a document's text or anything about a person. `last_error` is the service's own
 * wording or an error's class name, never a raw message from a dependency.
 */
@Entity('cl_rollout_steps')
@Index('uq_cl_rollout_steps_corpus_step', ['corpus', 'step'], { unique: true })
export class ClRolloutStep extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  corpus!: ClRolloutCorpus;

  @Column({ type: 'varchar', length: 16 })
  step!: ClRolloutStepKind;

  @Column({ type: 'varchar', length: 12, default: ClRolloutStatus.PENDING })
  status!: ClRolloutStatus;

  /** Times the step's action was started. Reset when a background step is seen making progress. */
  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'timestamp', name: 'started_at', nullable: true })
  startedAt?: Date | null;

  @Column({ type: 'timestamp', name: 'finished_at', nullable: true })
  finishedAt?: Date | null;

  /** Backoff: the action is not started again before this. */
  @Column({ type: 'timestamp', name: 'next_attempt_at', nullable: true })
  nextAttemptAt?: Date | null;

  @Column({ type: 'varchar', length: 300, name: 'last_error', nullable: true })
  lastError?: string | null;

  /** Counts only. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  detail!: Record<string, number>;
}
