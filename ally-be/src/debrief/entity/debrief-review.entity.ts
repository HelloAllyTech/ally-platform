import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { DebriefReviewVerdict } from '../enum/debrief-review.enum';

/**
 * One expert's verdict on one Debrief agent run (spec B2/B3, migration
 * 1981900700000): Good / Needs work and the hard fails they ticked, from the
 * judge's own list (`DEBRIEF_HARD_FAIL_CODES`). One per run and reviewer; a
 * second verdict replaces the first. The calibration agreement reads it
 * beside the judge's score on the run, so it calibrates the judge as a side
 * effect.
 */
@Entity('debrief_reviews')
@Index('debrief_reviews_run_reviewer_uq', ['runId', 'reviewerId'], {
  unique: true,
})
export class DebriefReview extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The run's organisation, copied from the run. */
  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId?: string | null;

  @Column({ type: 'uuid' })
  runId!: string;

  @Column({ type: 'int' })
  reviewerId!: number;

  @Column({ type: 'varchar', length: 12 })
  verdict!: DebriefReviewVerdict;

  /** Hard-fail codes the reviewer ticked. */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  hardFails!: string[];
}
