import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/** A learner's thumbs on one Ally message (+1 / -1), optionally with a comment. */
@Entity('guide_turn_feedback')
export class GuideTurnFeedback extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  messageId!: string;

  @Column({ type: 'int' })
  userId!: number;

  @Column({ type: 'smallint' })
  rating!: number;

  @Column({ type: 'text', nullable: true })
  comment?: string | null;

  @Column({ name: 'tenant_id', type: 'varchar' })
  tenantId!: string;
}
