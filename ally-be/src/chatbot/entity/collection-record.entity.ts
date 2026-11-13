import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from '../../common/entity/base-without-tenant.entity';

/** Who wrote a record: a user, an import, or an agent run (chunk 5a). */
export type RecordActorRef =
  | { kind: 'user'; user_id: number }
  | { kind: 'import'; user_id: number | null }
  | { kind: 'agent'; run_id: string };

/**
 * One entry of one list (chunk 5a). Every list of every bot shares this table; `data` holds the
 * values by field key. `contact_id` mirrors the list's person field, if it has one. `version` goes
 * up on every write, and an update that carries an older one is refused.
 */
@Entity('collection_records')
@Index('idx_collection_records_chatbot', ['chatbotId'])
@Index('idx_collection_records_contact', ['contactId'])
export class CollectionRecord extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'chatbot_id', type: 'uuid' })
  chatbotId!: string;

  @Column({ name: 'collection_id', type: 'uuid' })
  collectionId!: string;

  @Column({ type: 'jsonb', default: {} })
  data!: Record<string, unknown>;

  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId?: string | null;

  @Column({ name: 'created_by', type: 'jsonb', default: {} })
  createdBy!: RecordActorRef;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt?: Date | null;
}
