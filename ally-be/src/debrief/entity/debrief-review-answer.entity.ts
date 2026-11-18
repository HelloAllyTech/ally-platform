import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { DebriefAgreementMeasure } from '../enum/debrief-review.enum';

/**
 * One yes/no answer under an expert verdict, per κ-gate measure (migration
 * 1981900790000, debrief-agreement.util.ts): the answer, what it was
 * pre-filled with from the reviewer's comments and hard fails, and whether
 * they changed it. Replaced with the verdict. Read beside
 * `debrief_runs.workspace.judge` for the canary's κ gate.
 */
@Entity('debrief_review_answers')
@Index('debrief_review_answers_review_measure_uq', ['reviewId', 'measure'], {
  unique: true,
})
export class DebriefReviewAnswer extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId?: string | null;

  @Column({ type: 'uuid' })
  reviewId!: string;

  @Index('debrief_review_answers_run_idx')
  @Column({ type: 'uuid' })
  runId!: string;

  @Column({ type: 'varchar', length: 32 })
  measure!: DebriefAgreementMeasure;

  @Column({ type: 'boolean' })
  answer!: boolean;

  /** The answer it started as (No when a comment or hard fail said so, else Yes). */
  @Column({ type: 'boolean' })
  prefilled!: boolean;

  @Column({ type: 'boolean' })
  changed!: boolean;

  /** What the pre-fill came from: `{kind:'comment', commentId, turnIndex, …}` or `{kind:'hard_fail', code}`. */
  @Column({ type: 'jsonb', nullable: true })
  prefillSource?: Record<string, unknown> | null;
}
