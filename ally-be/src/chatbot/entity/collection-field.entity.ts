import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { BaseWithoutTenantEntity } from '../../common/entity/base-without-tenant.entity';
import { ListFieldType } from '../enum/list.enum';

/** What a conversation may do with a field's value (chunk 5a). */
export interface CollectionFieldPrivacy {
  /** Never written from a conversation, and never shown to the agent. Staff can still fill it in. */
  never_store?: boolean;
  /** The agent sees only the last 4 characters. Owners see and export the whole value. */
  masked?: boolean;
}

/**
 * One field of a list (chunk 5a). `key` is unique per list, archived fields included, and never
 * changes. `options` depends on the type: `values` for a select, `to` for a relation, `currency`
 * for money. An archived field is hidden from reads and writes and keeps its values.
 */
@Entity('collection_fields')
@Unique('UQ_collection_fields_key', ['collectionId', 'key'])
export class CollectionField extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'collection_id', type: 'uuid' })
  collectionId!: string;

  @Column({ type: 'varchar', length: 40 })
  key!: string;

  @Column({ type: 'varchar', length: 120 })
  label!: string;

  @Column({ type: 'varchar', length: 16 })
  type!: ListFieldType;

  @Column({ type: 'jsonb', default: {} })
  options!: Record<string, unknown>;

  @Column({ type: 'boolean', default: false })
  required!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  default?: unknown;

  @Column({ type: 'jsonb', default: {} })
  privacy!: CollectionFieldPrivacy;

  @Column({ name: 'agent_read', type: 'boolean', default: true })
  agentRead!: boolean;

  @Column({ name: 'agent_write', type: 'boolean', default: false })
  agentWrite!: boolean;

  @Column({ type: 'int', default: 0 })
  position!: number;

  @Column({ name: 'archived_at', type: 'timestamp', nullable: true })
  archivedAt?: Date | null;
}
