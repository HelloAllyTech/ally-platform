import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/** A key event or important conversation with a contact, visible to the whole team. */
@Entity('crm_contact_logs')
export class CrmContactLog extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_crm_contact_logs_contact_date')
  @Column({ name: 'contact_id', type: 'uuid' })
  contactId!: string;

  /** When it happened (a calendar date, not a timestamp). */
  @Column({ name: 'occurred_on', type: 'date' })
  occurredOn!: string;

  @Column({ type: 'text' })
  summary!: string;

  @Column({ name: 'author_id', type: 'integer', nullable: true })
  authorId!: number | null;
}
