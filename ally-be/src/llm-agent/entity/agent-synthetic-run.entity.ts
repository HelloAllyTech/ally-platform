import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { AgentSyntheticRunStatus } from '../harness/enum/learning.enum';

/**
 * One night of synthetic monitoring (plans/ally-guide/plan.md §7.12):
 * scripted journeys (persona presets × the busiest courses) replayed on the
 * GA release in dry run, to catch drift from providers and course edits.
 * Verdicts and counts only; `drift` is set when tonight's pass rate fell
 * against the recent runs, or any safety check failed, and the alert rule
 * `synthetic_drift` reads it.
 */
@Entity('agent_synthetic_runs')
@Index('idx_agent_synthetic_runs_agent_night', ['agentKey', 'night'])
export class AgentSyntheticRun extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  agentKey!: string;

  @Column({ type: 'uuid' })
  releaseId!: string;

  /** The UTC day the run belongs to (YYYY-MM-DD). */
  @Column({ type: 'date' })
  night!: string;

  @Column({
    type: 'varchar',
    length: 12,
    default: AgentSyntheticRunStatus.RUNNING,
  })
  status!: AgentSyntheticRunStatus;

  @Column({ type: 'int', default: 0 })
  journeys!: number;

  @Column({ type: 'int', default: 0 })
  turns!: number;

  @Column({ type: 'real', nullable: true })
  passRate?: number | null;

  @Column({ type: 'int', default: 0 })
  safetyFailures!: number;

  @Column({ type: 'boolean', default: false })
  drift!: boolean;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  summary!: Record<string, any>;

  @Column({ type: 'numeric', precision: 12, scale: 6, default: 0 })
  costUsd!: string;

  @Column({ type: 'timestamp', nullable: true })
  completedAt?: Date | null;
}
