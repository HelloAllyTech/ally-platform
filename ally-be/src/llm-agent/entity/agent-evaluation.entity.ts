import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  AgentEvaluationSample,
  AgentEvaluationStatus,
} from '../harness/enum/eval.enum';

/**
 * The nightly evaluator's verdict on one production window — an agent turn
 * and the messages before it (plans/ally-guide/plan.md §7.13). Verdicts
 * only: `deterministic`, `critic` and `verifier` hold check ids, criterion
 * verdicts and short reasons written by the judges, never the learner's
 * words. One row per turn (`turnId` unique), so a re-run never double-counts.
 */
@Entity('agent_evaluations')
@Index('idx_agent_evaluations_agent_night', ['agentKey', 'night'])
export class AgentEvaluation extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  agentKey!: string;

  @Column({ type: 'uuid', unique: true })
  turnId!: string;

  @Column({ type: 'uuid' })
  threadId!: string;

  @Column({ type: 'uuid', nullable: true })
  releaseId?: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  arm?: string | null;

  /** The UTC day whose turns this run judged (YYYY-MM-DD). */
  @Column({ type: 'date' })
  night!: string;

  @Column({ type: 'varchar', length: 12 })
  sample!: AgentEvaluationSample;

  @Column({ type: 'varchar', length: 12 })
  status!: AgentEvaluationStatus;

  /** Why the window was flagged (sentinel, mode, thumbs_down, check ids…). */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  flags!: string[];

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  deterministic!: Record<string, any>[];

  @Column({ type: 'jsonb', nullable: true })
  critic?: Record<string, any> | null;

  @Column({ type: 'jsonb', nullable: true })
  verifier?: Record<string, any> | null;

  /** Criteria the critic and the verifier judged differently. */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  disagreements!: string[];

  @Column({ type: 'boolean', default: false })
  safetyFlag!: boolean;

  @Column({ type: 'numeric', precision: 12, scale: 6, default: 0 })
  costUsd!: string;

  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId?: string | null;
}
