import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from '../../common/entity/base-without-tenant.entity';
import { ListConstraintKind } from '../enum/list.enum';

/**
 * A rule on a list (chunk 5a): unique, capacity, limit per person or transitions. The config's
 * shape per kind is in `chatbot/lists/list-types.ts`. Rules are enforced in code inside the
 * write's transaction, never only in a prompt or a screen.
 */
@Entity('collection_constraints')
@Index('idx_collection_constraints_collection', ['collectionId'])
export class CollectionConstraint extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'collection_id', type: 'uuid' })
  collectionId!: string;

  @Column({ type: 'varchar', length: 24 })
  kind!: ListConstraintKind;

  @Column({ type: 'jsonb', default: {} })
  config!: Record<string, unknown>;
}
