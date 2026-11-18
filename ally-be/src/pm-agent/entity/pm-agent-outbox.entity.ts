import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  PmOutboxAction,
  PmOutboxStatus,
  PmOutboxStep,
} from '../enum/pm-agent.enum';

/**
 * The accept outbox: written in the same transaction as the card's move to
 * `accepted_pending`, not due until the undo window closes. UNIQUE (cardId, action) makes
 * a double accept impossible at the database. Since 2026-11-17 every row is `file_roadmap`
 * (FILE_ROADMAP → DONE); `build` rows are the removed Accept → Builder chain.
 */
@Entity('pm_agent_outbox')
@Index('idx_pm_agent_outbox_due', ['status', 'dueAt'])
export class PmAgentOutbox extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  cardId!: string;

  @Column({
    type: 'varchar',
    length: 16,
    default: PmOutboxAction.FILE_ROADMAP,
  })
  action!: PmOutboxAction;

  @Column({ type: 'varchar', length: 16, default: PmOutboxStatus.PENDING })
  status!: PmOutboxStatus;

  @Column({
    type: 'varchar',
    length: 24,
    default: PmOutboxStep.FILE_ROADMAP,
  })
  step!: PmOutboxStep;

  @Column({ type: 'timestamptz' })
  dueAt!: Date;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'text', nullable: true })
  lastError?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lockedUntil?: Date | null;

  /** The accepting admin: Builder sessions are created on their account. */
  @Column({ type: 'int' })
  createdBy!: number;
}
