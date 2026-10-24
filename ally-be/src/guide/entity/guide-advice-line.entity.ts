import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

export type GuideAdviceStatus = 'pending' | 'approved' | 'rejected';

/**
 * One advice line a finisher left at the finale's mentor door
 * (plans/ally-guide/plan.md §4.9, Appendix A "Peer"): at most 200
 * characters, one per learner per course. Moderated before anyone sees it,
 * shown anonymously to learners in the same organisation once enough have
 * finished, and always rendered as quoted data.
 */
@Entity('guide_advice_lines')
@Index('uq_guide_advice_lines_user_track', ['userId', 'trackId'], {
  unique: true,
})
@Index('idx_guide_advice_lines_track_tenant_status', [
  'trackId',
  'tenantId',
  'status',
])
export class GuideAdviceLine extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int' })
  userId!: number;

  @Column({ type: 'uuid' })
  trackId!: string;

  @Column({ type: 'varchar', length: 200 })
  text!: string;

  @Column({ type: 'varchar', length: 12, default: 'pending' })
  status!: GuideAdviceStatus;

  /** Why the line needs a careful look (`risk_words`): for the moderator. */
  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  flags!: string[];

  @Column({ type: 'int', nullable: true })
  moderatedBy?: number | null;

  @Column({ type: 'timestamp', nullable: true })
  moderatedAt?: Date | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  rejectReason?: string | null;

  @Column({ name: 'tenant_id', type: 'varchar' })
  tenantId!: string;
}
