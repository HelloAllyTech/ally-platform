import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A key that lets a coding agent (Claude Code) write DRAFT blog posts for its owner. Only the
 * hash is stored; the key itself is shown once, when it is created. A key can create and edit
 * drafts and request image uploads; it can never publish, unpublish or delete a post.
 */
@Entity('blog_author_keys')
export class BlogAuthorKey extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The admin user the drafts are written as. */
  @Index('idx_blog_author_keys_owner')
  @Column({ type: 'int', name: 'owner_id' })
  ownerId!: number;

  @Column({ type: 'varchar', length: 80 })
  label!: string;

  @Index('uq_blog_author_keys_hash', { unique: true })
  @Column({ type: 'varchar', length: 64, name: 'key_hash' })
  keyHash!: string;

  /** First characters of the key, so a person can tell their keys apart. */
  @Column({ type: 'varchar', length: 12, name: 'key_prefix' })
  keyPrefix!: string;

  @Column({ type: 'timestamp', name: 'last_used_at', nullable: true })
  lastUsedAt?: Date | null;

  @Column({ type: 'timestamp', name: 'revoked_at', nullable: true })
  revokedAt?: Date | null;
}
