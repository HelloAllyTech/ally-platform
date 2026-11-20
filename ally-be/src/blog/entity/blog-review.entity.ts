import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A link that lets anyone, without signing in, read a DRAFT post and leave suggestions. The token
 * is long and random, so the link cannot be guessed; it stops working when it is revoked or expires.
 */
@Entity('blog_review_links')
export class BlogReviewLink extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_blog_review_links_blog')
  @Column({ type: 'uuid', name: 'blog_id' })
  blogId!: string;

  @Index('uq_blog_review_links_token', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  token!: string;

  @Column({ type: 'timestamp', name: 'expires_at' })
  expiresAt!: Date;

  @Column({ type: 'timestamp', name: 'revoked_at', nullable: true })
  revokedAt?: Date | null;

  @Column({ type: 'int', name: 'created_by' })
  createdBy!: number;
}

export enum BlogSuggestionStatus {
  OPEN = 'OPEN',
  RESOLVED = 'RESOLVED',
}

/** A suggestion a reviewer sent through a review link. */
@Entity('blog_review_suggestions')
export class BlogReviewSuggestion extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_blog_review_suggestions_blog')
  @Column({ type: 'uuid', name: 'blog_id' })
  blogId!: string;

  @Column({ type: 'uuid', name: 'link_id' })
  linkId!: string;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email?: string | null;

  @Column({ type: 'text' })
  comment!: string;

  /** The text the reviewer selected, when they selected one. */
  @Column({ type: 'text', nullable: true })
  quote?: string | null;

  @Column({
    type: 'varchar',
    length: 10,
    default: BlogSuggestionStatus.OPEN,
  })
  status!: BlogSuggestionStatus;
}
