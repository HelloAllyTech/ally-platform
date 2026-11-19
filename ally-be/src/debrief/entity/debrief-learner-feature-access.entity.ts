import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * Who has a learner-facing debrief feature (migration 1984800000000). One row per person; a row
 * with no `userId` means everyone. Managed in Debrief settings › Learner features.
 */
@Entity('debrief_learner_feature_access')
export class DebriefLearnerFeatureAccess extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 40 })
  feature!: string;

  @Column({ type: 'int', nullable: true })
  userId?: number | null;

  @Column({ type: 'int', nullable: true })
  addedBy?: number | null;
}
