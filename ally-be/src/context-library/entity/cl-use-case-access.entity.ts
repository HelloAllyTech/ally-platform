import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Which collections a use case may read. Data, so a grant can change without a deploy.
 *
 * A row here can never override a lock: collections a use case must never read are listed
 * on the collection profile (`neverGrantTo`) and enforced in code whatever this says.
 */
@Entity('cl_use_case_access')
@Index('uq_cl_use_case_access', ['useCase', 'collectionId'], { unique: true })
export class ClUseCaseAccess extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 40, name: 'use_case' })
  useCase!: string;

  @Column({ type: 'varchar', length: 48, name: 'collection_id' })
  collectionId!: string;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  /** Fusion weight when the use case reads several collections. */
  @Column({ type: 'real', default: 1 })
  weight!: number;

  @Column({ type: 'int', name: 'updated_by', nullable: true })
  updatedBy?: number | null;
}

/** Every change to a grant, so "who let engineers read this?" has an answer. */
@Entity('cl_use_case_access_log')
export class ClUseCaseAccessLog extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 40, name: 'use_case' })
  useCase!: string;

  @Column({ type: 'varchar', length: 48, name: 'collection_id' })
  collectionId!: string;

  @Column({ type: 'boolean', name: 'enabled_before', nullable: true })
  enabledBefore?: boolean | null;

  @Column({ type: 'boolean', name: 'enabled_after' })
  enabledAfter!: boolean;

  @Column({ type: 'real', name: 'weight_after' })
  weightAfter!: number;

  @Column({ type: 'int', name: 'changed_by', nullable: true })
  changedBy?: number | null;
}
