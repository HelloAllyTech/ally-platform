import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * One address on the daily product-updates email, added from the admin
 * console. Always lower-cased (the table checks it), so uniqueness is
 * case-insensitive. The env var `PRODUCT_UPDATES_DIGEST_TO` is a second,
 * read-only source; the digest sends to both.
 */
@Entity('product_update_digest_recipients')
export class ProductUpdateDigestRecipient extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('uq_product_update_digest_recipients_email', { unique: true })
  @Column({ type: 'varchar', length: 254 })
  email!: string;

  @Column({ name: 'added_by', type: 'integer', nullable: true })
  addedBy!: number | null;
}
