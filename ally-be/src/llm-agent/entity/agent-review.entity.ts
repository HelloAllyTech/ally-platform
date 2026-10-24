import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  AgentReviewReason,
  AgentReviewStatus,
} from '../harness/enum/eval.enum';

/**
 * One window in the human review queue (plans/ally-guide/plan.md §7.13).
 * Reviewers read the window redacted and label each rubric criterion
 * without seeing the critic's verdicts; `labels` against the linked
 * evaluation's critic verdicts is what κ is computed from. One row per
 * (turn, reason).
 */
@Entity('agent_reviews')
@Index('idx_agent_reviews_status_priority', ['agentKey', 'status', 'priority'])
export class AgentReview extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  agentKey!: string;

  @Column({ type: 'uuid' })
  turnId!: string;

  @Column({ type: 'uuid' })
  threadId!: string;

  @Column({ type: 'uuid', nullable: true })
  evaluationId?: string | null;

  /** The thumbs-down this review was opened for. */
  @Column({ type: 'uuid', nullable: true })
  feedbackId?: string | null;

  @Column({ type: 'varchar', length: 16 })
  reason!: AgentReviewReason;

  @Column({ type: 'varchar', length: 12, default: AgentReviewStatus.OPEN })
  status!: AgentReviewStatus;

  /** Lower first: 0 safety, 1 disagreement, 2 thumbs-down, 3 calibration. */
  @Column({ type: 'smallint', default: 3 })
  priority!: number;

  @Column({ type: 'int', nullable: true })
  reviewerId?: number | null;

  @Column({ type: 'timestamp', nullable: true })
  claimedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt?: Date | null;

  /** criterion id → 'pass' | 'fail' | 'na', as the reviewer judged it. */
  @Column({ type: 'jsonb', nullable: true })
  labels?: Record<string, string> | null;

  /** The reviewer's overall call: 'ok' or 'problem'. */
  @Column({ type: 'varchar', length: 12, nullable: true })
  verdict?: string | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId?: string | null;
}
