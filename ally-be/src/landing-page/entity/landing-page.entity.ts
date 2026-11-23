import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Tenant } from 'src/tenant/entity/tenant.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { LandingPageStatus } from '../enum/landing-page-status.enum';
import { LandingPageConfig } from '../type/landing-page-config.type';

/**
 * A public landing page owned by one organization, served at
 * `/<tenant code>/<slug>` on the consumer app. Managed by platform admins from
 * the admin console, so the entity is not tenant-scoped (it extends
 * BaseWithoutTenantEntity) and carries its own `tenant_id`.
 *
 * `config` is the draft being edited; `publishedConfig` is the copy visitors
 * see, written only by publish. They differ while there are unpublished edits.
 */
@Entity('landing_pages')
@Index('uq_landing_pages_tenant_slug_idx', ['tenantId', 'slug'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
export class LandingPage extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_landing_pages_tenant_idx')
  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId!: string;

  @ManyToOne(() => Tenant, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tenant_id' })
  tenant?: Tenant;

  // The admin's own label for the page; never shown to visitors.
  @Column({ type: 'varchar', length: 160 })
  name!: string;

  // Last segment of the public address (/<tenant code>/<slug>).
  @Column({ type: 'varchar', length: 60 })
  slug!: string;

  @Column({ type: 'varchar', length: 20, default: LandingPageStatus.DRAFT })
  status!: LandingPageStatus;

  @Column({ type: 'jsonb' })
  config!: LandingPageConfig;

  @Column({ type: 'jsonb', name: 'published_config', nullable: true })
  publishedConfig?: LandingPageConfig | null;

  // Set on every publish; cleared on unpublish.
  @Column({ type: 'timestamp', name: 'published_at', nullable: true })
  publishedAt?: Date | null;

  @Column({ type: 'int', name: 'created_by' })
  createdBy!: number;

  @Column({ type: 'int', name: 'updated_by' })
  updatedBy!: number;

  @DeleteDateColumn()
  deletedAt?: Date;
}
