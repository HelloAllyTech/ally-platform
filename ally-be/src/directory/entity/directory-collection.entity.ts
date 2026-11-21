import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from '../../common/entity/base-without-tenant.entity';

export type DirectoryLayout = 'grid' | 'list';

/** What the collection's public landing page looks like and lets a visitor do. */
export interface DirectoryCollectionSettings {
  headline: string;
  tagline: string;
  accentColor: string;
  layout: DirectoryLayout;
  showSearch: boolean;
  showCategoryFilter: boolean;
  showContactDetails: boolean;
  contactEmail: string;
  footerNote: string;
}

export const DEFAULT_COLLECTION_SETTINGS: DirectoryCollectionSettings = {
  headline: '',
  tagline: '',
  accentColor: '#4338CA',
  layout: 'grid',
  showSearch: true,
  showCategoryFilter: true,
  showContactDetails: true,
  contactEmail: '',
  footerNote: '',
};

/**
 * A saved view: a curated list of entries with its own public landing page at `/d/<slug>` and,
 * optionally, a custom domain. Only its owner edits it. `slug` and `custom_domain` are unique
 * ignoring case (the indexes are on `lower(...)`, declared in the migration).
 */
@Entity('directory_collections')
@Index('idx_directory_collections_owner', ['ownerId'])
export class DirectoryCollection extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'owner_id', type: 'int' })
  ownerId!: number;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'text', default: '' })
  description!: string;

  @Column({ type: 'varchar', length: 48 })
  slug!: string;

  /** The landing page answers 404 until this is on. */
  @Column({ type: 'boolean', default: false })
  published!: boolean;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  settings!: DirectoryCollectionSettings;

  @Column({
    name: 'custom_domain',
    type: 'varchar',
    length: 253,
    nullable: true,
  })
  customDomain!: string | null;

  /** The TXT value the owner publishes at `_ally-directory.<domain>` to prove they own it. */
  @Column({
    name: 'domain_verification_token',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  domainVerificationToken!: string | null;

  @Column({ name: 'domain_verified_at', type: 'timestamptz', nullable: true })
  domainVerifiedAt!: Date | null;
}
