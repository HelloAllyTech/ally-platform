import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  GuideCardKind,
  GuideCardPresentation,
  GuideCardState,
  GuideTone,
} from '../enum/guide.enum';

/**
 * A card presented in a thread (plan §5.6). `payload` is learner-safe by
 * construction — it never holds answer keys (plan §6.4). A course-item card
 * moves to DONE only when `track_item_progress` says COMPLETED (`verifiedAt`).
 */
@Entity('guide_cards')
@Index('idx_guide_cards_thread', ['threadId'])
export class GuideCard extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  threadId!: string;

  @Column({ type: 'varchar', length: 24 })
  kind!: GuideCardKind;

  @Column({ type: 'varchar', length: 8 })
  presentation!: GuideCardPresentation;

  @Column({ type: 'varchar', length: 12, default: GuideCardState.ANNOUNCED })
  state!: GuideCardState;

  @Column({ type: 'varchar', length: 8, nullable: true })
  tone?: GuideTone | null;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'uuid', nullable: true })
  trackItemId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  trackItemProgressId?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  payload?: Record<string, any> | null;

  /** Side-quest spec, the learner's response and Ally's feedback (never graded). */
  @Column({ type: 'jsonb', nullable: true })
  microActivity?: Record<string, any> | null;

  @Column({ type: 'int', nullable: true })
  presentedSeq?: number | null;

  @Column({ type: 'timestamp', nullable: true })
  verifiedAt?: Date | null;

  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId?: string | null;
}
