import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from '../../common/entity/base-without-tenant.entity';

export enum DirectoryVisibility {
  PUBLIC = 'public',
  PRIVATE = 'private',
}

/**
 * One resource in the mental health directory (a service, a hotline, a programme).
 *
 * Deliberately not tenant-scoped: any signed-in user adds entries, public ones are readable by
 * everyone, and a private one is readable and editable only by its owner (`owner_id`).
 */
@Entity('directory_entries')
@Index('idx_directory_entries_owner', ['ownerId'])
@Index('idx_directory_entries_visibility', ['visibility'])
export class DirectoryEntry extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'owner_id', type: 'int' })
  ownerId!: number;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'text', default: '' })
  description!: string;

  /** Free text, e.g. "Crisis line", "Counselling", "Peer support". */
  @Column({ type: 'varchar', length: 80, default: '' })
  category!: string;

  /** The organisation that runs the resource. */
  @Column({ type: 'varchar', length: 200, default: '' })
  organization!: string;

  @Column({ name: 'website_url', type: 'varchar', length: 500, default: '' })
  websiteUrl!: string;

  @Column({ type: 'varchar', length: 60, default: '' })
  phone!: string;

  @Column({ type: 'varchar', length: 254, default: '' })
  email!: string;

  @Column({ type: 'varchar', length: 300, default: '' })
  address!: string;

  @Column({ type: 'varchar', length: 100, default: '' })
  city!: string;

  @Column({ type: 'varchar', length: 100, default: '' })
  region!: string;

  @Column({ type: 'varchar', length: 100, default: '' })
  country!: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  tags!: string[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  languages!: string[];

  @Column({ type: 'varchar', length: 16, default: DirectoryVisibility.PRIVATE })
  visibility!: DirectoryVisibility;
}
