import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  AgentEvalRunKind,
  AgentEvalRunStatus,
} from '../harness/enum/eval.enum';

/**
 * One eval run of a release (plans/ally-guide/plan.md §7.13): a smoke run
 * for a draft, or a gate run that replays every active case three times
 * against the release and against the GA baseline. `summary` holds the
 * gate's decision and its reasons; the per-case rows are in
 * `agent_eval_results`.
 */
@Entity('agent_eval_runs')
@Index('idx_agent_eval_runs_release_created', ['releaseId', 'createdAt'])
export class AgentEvalRun extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  agentKey!: string;

  @Column({ type: 'uuid' })
  releaseId!: string;

  /** The release it is compared against (the GA at the time). */
  @Column({ type: 'uuid', nullable: true })
  baselineReleaseId?: string | null;

  @Column({ type: 'varchar', length: 12 })
  kind!: AgentEvalRunKind;

  @Column({ type: 'varchar', length: 12, default: AgentEvalRunStatus.QUEUED })
  status!: AgentEvalRunStatus;

  @Column({ type: 'int', default: 1 })
  repetitions!: number;

  @Column({ type: 'int', default: 0 })
  caseCount!: number;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  summary!: Record<string, any>;

  @Column({ type: 'numeric', precision: 12, scale: 6, default: 0 })
  costUsd!: string;

  @Column({ type: 'int', nullable: true })
  triggeredBy?: number | null;

  @Column({ type: 'timestamp', nullable: true })
  startedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt?: Date | null;
}
