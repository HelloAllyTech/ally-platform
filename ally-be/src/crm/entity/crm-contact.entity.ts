import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * One person the Ally team knows: who they are, where they work, how we met.
 * Shared by every admin holding the `crm_contacts` toggle. Platform-wide.
 */
@Entity('crm_contacts')
export class CrmContact extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'full_name', type: 'varchar', length: 200 })
  fullName!: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  organization!: string | null;

  @Column({ name: 'job_title', type: 'varchar', length: 200, nullable: true })
  jobTitle!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  /** The one person coordinating with this contact. Null when unassigned. */
  @Index('idx_crm_contacts_relationship_manager')
  @Column({ name: 'relationship_manager_id', type: 'integer', nullable: true })
  relationshipManagerId!: number | null;

  @Column({ name: 'created_by', type: 'integer', nullable: true })
  createdBy!: number | null;

  @Column({ name: 'updated_by', type: 'integer', nullable: true })
  updatedBy!: number | null;
}
