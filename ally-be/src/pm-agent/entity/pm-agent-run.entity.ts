import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { PmRunStatus, PmRunTrigger } from '../enum/pm-agent.enum';

/**
 * One agent run. At most one is `running` (partial unique index in the migration), which
 * is the run lock that holds across ECS tasks. `reservedUsd` is the reserve-before-spend
 * ledger's open reservation; `spentUsd` what was actually charged.
 */
@Entity('pm_agent_runs')
@Index('idx_pm_agent_runs_started', ['startedAt'])
export class PmAgentRun extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 16, default: PmRunStatus.RUNNING })
  status!: PmRunStatus;

  @Column({ type: 'varchar', length: 16 })
  trigger!: PmRunTrigger;

  /** IST calendar date the run belongs to. */
  @Column({ type: 'date' })
  runDate!: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  stopReason?: string | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  startedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt?: Date | null;

  @Column({ type: 'numeric', precision: 10, scale: 4, default: 0 })
  reservedUsd!: string;

  @Column({ type: 'numeric', precision: 10, scale: 4, default: 0 })
  spentUsd!: string;

  @Column({ type: 'int', default: 0 })
  cardsCreated!: number;

  /** Lanes selected for the run and their per-lane outcome. */
  @Column({ type: 'jsonb', nullable: true })
  lanes?: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  error?: string | null;

  /** The admin who pressed Run now; null for a scheduled run. */
  @Column({ type: 'int', nullable: true })
  triggeredBy?: number | null;
}
