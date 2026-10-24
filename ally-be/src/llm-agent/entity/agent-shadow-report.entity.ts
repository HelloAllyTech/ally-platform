import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { AgentShadowStatus } from '../harness/enum/learning.enum';

/**
 * A shadow replay of a release (plans/ally-guide/plan.md §7.4): recent real
 * turns replayed on the candidate in dry run and compared with what the GA
 * release actually said. Verdicts and counts only — `summary` holds per-turn
 * check ids and the comparison, never the learner's or the model's words.
 * Linked from `agent_releases.shadowReportId`.
 */
@Entity('agent_shadow_reports')
@Index('idx_agent_shadow_reports_release', ['releaseId', 'createdAt'])
export class AgentShadowReport extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  agentKey!: string;

  @Column({ type: 'uuid' })
  releaseId!: string;

  /** The GA release whose real replies the candidate is compared with. */
  @Column({ type: 'uuid', nullable: true })
  baselineReleaseId?: string | null;

  @Column({ type: 'varchar', length: 14, default: AgentShadowStatus.RUNNING })
  status!: AgentShadowStatus;

  @Column({ type: 'int', default: 0 })
  turnCount!: number;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  summary!: Record<string, any>;

  @Column({ type: 'numeric', precision: 12, scale: 6, default: 0 })
  costUsd!: string;

  /** A person, or null when the pipeline started it. */
  @Column({ type: 'int', nullable: true })
  triggeredBy?: number | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt?: Date | null;
}
