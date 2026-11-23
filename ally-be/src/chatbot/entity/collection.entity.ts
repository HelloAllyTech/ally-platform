import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from '../../common/entity/base-without-tenant.entity';

/** A list's settings (chunk 5a). Each key names a live field of the list. */
export interface CollectionSettings {
  /** The field whose value is the record's title. */
  title_field?: string;
  /** A field key, `-key` for descending. */
  default_sort?: string;
  /** A relation-to-contact field: the person each record belongs to, mirrored into `contact_id`. */
  person_field?: string;
}

/**
 * One of a bot's lists (Agents v2, chunk 5a): Slots, Appointments, Leads… Its fields, rules and
 * records hang off it. `key` is a slug, unique per bot among lists not deleted. Deleting is soft;
 * the list can be restored for 30 days if its key is still free.
 */
@Entity('collections')
@Index('idx_collections_chatbot', ['chatbotId'])
export class Collection extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'chatbot_id', type: 'uuid' })
  chatbotId!: string;

  @Column({ type: 'varchar', length: 40 })
  key!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'jsonb', default: {} })
  settings!: CollectionSettings;

  /** List-wide: the agent may read records (fields still need their own switch). */
  @Column({ name: 'agent_read', type: 'boolean', default: false })
  agentRead!: boolean;

  /** List-wide: the agent may write records (fields still need their own switch). */
  @Column({ name: 'agent_write', type: 'boolean', default: false })
  agentWrite!: boolean;

  @Column({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt?: Date | null;
}
