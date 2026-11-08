import { BaseWithoutTenantEntity } from '../../common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** What an image is for. A logo may be a rasterised SVG; the rest are photos. */
export enum BotImageKind {
  LOGO = 'logo',
  COVER = 'cover',
  SHARE = 'share',
  LANDING = 'landing',
  PERSON = 'person',
}

export enum BotImageStatus {
  ATTACHED = 'attached',
  /** Removed by the owner: unreadable at once, files deleted 30 days later (so Undo works). */
  DETACHED = 'detached',
  /** Files deleted. The row stays as a record. */
  PURGED = 'purged',
}

/** The stored object keys, by size. */
export interface BotImageVariants {
  256: string;
  768: string;
  1600: string;
  original: string;
}

/**
 * An image on a bot's page (chunk 20d): logo, cover, link preview, landing and team photos.
 * Checked by its bytes, re-encoded without metadata, and stored in the private bucket under
 * `bot-images/<tenant>/<chatbot>/<hash>-<size>`. Visitors read it only through the public image
 * route, and only while the bot's page is live and uses it; the dashboard reads signed URLs.
 */
@Entity('bot_images')
@Index('idx_bot_images_chatbot', ['chatbotId', 'status'])
export class BotImage extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'chatbot_id' })
  chatbotId!: string;

  /** The uploader's organisation, for the storage path. */
  @Column({ type: 'uuid', name: 'tenant_id', nullable: true })
  tenantId!: string | null;

  @Column({ type: 'varchar', length: 16 })
  kind!: BotImageKind;

  @Column({ type: 'varchar', length: 16, default: BotImageStatus.ATTACHED })
  status!: BotImageStatus;

  /** sha256 of the re-encoded original; the first 32 characters name the files. */
  @Column({ type: 'varchar', length: 64, name: 'content_hash' })
  contentHash!: string;

  @Column({ type: 'int' })
  width!: number;

  @Column({ type: 'int' })
  height!: number;

  @Column({ type: 'jsonb' })
  variants!: BotImageVariants;

  /** The original's content type (image/png, image/jpeg or image/webp). */
  @Column({ type: 'varchar', length: 32, name: 'content_type' })
  contentType!: string;

  @Column({ type: 'varchar', length: 300, default: '' })
  alt!: string;

  /** Shown back to the owner ("logo.png"). Never used to decide the type. */
  @Column({ type: 'varchar', length: 200, name: 'original_name', default: '' })
  originalName!: string;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdBy!: number | null;

  @Column({ name: 'detached_at', type: 'timestamptz', nullable: true })
  detachedAt!: Date | null;
}
