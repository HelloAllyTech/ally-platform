import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum GeneratedImageStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  /** Its files were removed by the retention cleanup; the row stays for audit. */
  EXPIRED = 'expired',
}

export type ImageReferenceRole = 'character' | 'setting' | 'style' | 'previous';

/** A reference as resolved at request time: what the worker sends, in order. */
export interface StoredImageReference {
  role: ImageReferenceRole | 'refine';
  label?: string;
  /** A generated image (its original is used), or … */
  imageId?: string;
  /** … an image already in one of our buckets. */
  s3Bucket?: string;
  s3Key?: string;
}

export interface ImageCheckResult {
  passed: boolean;
  issues: string[];
  model?: string;
}

/** Where the image is meant to go; free-form ids, for history and analytics. */
export interface GeneratedImageContext {
  trackId?: string;
  itemId?: string;
  nodeId?: string;
  scenarioId?: string;
  characterId?: string;
  [key: string]: unknown;
}

/**
 * One AI-generated image: the job that makes it and, once it exists, its
 * history row. Every candidate an author ever saw is here, accepted or not,
 * so a rejected-then-wanted image is never lost and every image can be traced
 * to its prompt, references, model and cost.
 *
 * Not a tenant-scoped base entity because the API's authoring surfaces
 * (tracks, characters) are not tenant-scoped either; `tenantId` records the
 * author's tenant and every read filters on it.
 */
@Entity('generated_images')
@Index('idx_generated_images_status_created', ['status', 'createdAt'])
@Index('idx_generated_images_tenant_slot', ['tenantId', 'slotKey', 'createdAt'])
@Index('idx_generated_images_creator_status', ['createdBy', 'status'])
@Index('idx_generated_images_cast', ['characterId', 'styleId', 'acceptedAt'])
export class GeneratedImage extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  tenantId?: string | null;

  @Column({ type: 'int' })
  createdBy!: number;

  /** The images requested in one press of Generate (or one batch). */
  @Column({ type: 'uuid' })
  batchId!: string;

  @Column({ type: 'varchar', length: 32 })
  slotKind!: string;

  /** The slot instance, e.g. `track:<id>:item:<id>:node:<id>`; groups history. */
  @Column({ type: 'varchar', length: 300, nullable: true })
  slotKey?: string | null;

  @Column({ type: 'varchar', length: 48 })
  styleId!: string;

  @Column({ type: 'varchar', length: 16, default: GeneratedImageStatus.QUEUED })
  status!: GeneratedImageStatus;

  /** What the author asked for, in their words. */
  @Column({ type: 'text' })
  description!: string;

  /** The structured scene the compose step derived from the description. */
  @Column({ type: 'jsonb', nullable: true })
  sceneSpec?: Record<string, unknown> | null;

  /** The compiled prompt sent to the provider (guardrails included). */
  @Column({ type: 'text' })
  prompt!: string;

  @Column({ type: 'text', nullable: true })
  altText?: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  references!: StoredImageReference[];

  /** Characters in the picture (their appearance text was compiled in). */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  castCharacterIds!: string[];

  /** Set on a cast sheet: the character it is the sheet of. */
  @Column({ type: 'uuid', nullable: true })
  characterId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  refinedFromId?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  context?: GeneratedImageContext | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  provider?: string | null;

  @Column({ type: 'varchar', length: 96, nullable: true })
  model?: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  quality?: string | null;

  @Column({ type: 'int', nullable: true })
  width?: number | null;

  @Column({ type: 'int', nullable: true })
  height?: number | null;

  /** Full-quality PNG, used when this image is later a reference. */
  @Column({ type: 'text', nullable: true })
  originalKey?: string | null;

  /** The cropped WebP the author's form stores. */
  @Column({ type: 'text', nullable: true })
  displayKey?: string | null;

  @Column({ type: 'text', nullable: true })
  imageUrl?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  check?: ImageCheckResult | null;

  /** Author-facing failure message. */
  @Column({ type: 'text', nullable: true })
  error?: string | null;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  heartbeatAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  acceptedAt?: Date | null;

  /** Estimated spend for this image (all attempts, compose and judge included). */
  @Column({ type: 'numeric', precision: 10, scale: 4, nullable: true })
  costUsd?: string | null;
}
