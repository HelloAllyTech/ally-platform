import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import {
  ClChunkConfidence,
  ClChunkOrigin,
  ClChunkStatus,
  ClEmbeddingStatus,
} from '../enum/context-library.enum';

export interface ClExampleQuery {
  text: string;
  /** `extracted` by the extractor, `enriched` for authored chunks, `learned` from real searches. */
  origin: 'extracted' | 'enriched' | 'learned';
}

export interface ClCitation {
  title: string;
  sectionPath?: string | null;
  pageFrom?: number;
  pageTo?: number;
}

/**
 * The retrieval unit, in every collection. Postgres is the system of record; the Weaviate
 * index is derived from these rows through the outbox fields below.
 *
 * `statement` and `body` of an authored, imported or synced chunk are its author's (or its
 * source table's) and no loop ever rewrites them — enrichment adds retrieval metadata
 * alongside, never instead.
 */
@Entity('cl_chunks')
@Index('idx_cl_chunks_collection_status', ['collectionId', 'status'])
export class ClChunk extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 48, name: 'collection_id' })
  collectionId!: string;

  /** `FP-0142`. Per-collection sequence, never reused; superseded codes redirect. */
  @Index('uq_cl_chunks_code', { unique: true })
  @Column({ type: 'varchar', length: 16 })
  code!: string;

  @Column({ type: 'varchar', length: 16 })
  origin!: ClChunkOrigin;

  @Column({ type: 'text' })
  statement!: string;

  @Column({ type: 'text', nullable: true })
  body?: string | null;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  situations!: string[];

  @Column({
    type: 'jsonb',
    name: 'example_queries',
    default: () => "'[]'::jsonb",
  })
  exampleQueries!: ClExampleQuery[];

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  keywords!: string[];

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  topics!: string[];

  /** The profile's filterable attributes. */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  facets!: Record<string, string | string[]>;

  /** The profile's other typed fields (rationale, probe, voiceSamples, …). */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  attributes!: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  citation?: ClCitation | null;

  // ── Audience ──────────────────────────────────────────────────────────────
  // Who may see the chunk. `isGlobal` OR the asker's organisation in `tenantIds`. The owner
  // is who may edit it; an organisation admin can only target their own organisation.

  @Column({ type: 'boolean', name: 'is_global', default: true })
  isGlobal!: boolean;

  @Column({
    type: 'text',
    array: true,
    name: 'tenant_ids',
    default: () => "'{}'",
  })
  tenantIds!: string[];

  @Index('idx_cl_chunks_owner')
  @Column({ type: 'uuid', name: 'owner_tenant_id', nullable: true })
  ownerTenantId?: string | null;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Protected from every automatic edit or retirement. */
  @Column({ type: 'boolean', default: false })
  pinned!: boolean;

  @Column({ type: 'varchar', length: 16, default: ClChunkConfidence.STANDARD })
  confidence!: ClChunkConfidence;

  @Column({ type: 'varchar', length: 16 })
  status!: ClChunkStatus;

  @Column({ type: 'uuid', name: 'superseded_by_id', nullable: true })
  supersededById?: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  quality!: Record<string, unknown>;

  /** How many distinct documents (or agent agreements) produced it. */
  @Column({ type: 'int', name: 'source_count', default: 1 })
  sourceCount!: number;

  @Column({
    type: 'varchar',
    length: 40,
    name: 'distill_prompt_version',
    nullable: true,
  })
  distillPromptVersion?: string | null;

  /** Synced chunks: `table:rowId` of the row they mirror. */
  @Index('uq_cl_chunks_sync_key', {
    unique: true,
    where: '"sync_key" IS NOT NULL',
  })
  @Column({ type: 'varchar', length: 120, name: 'sync_key', nullable: true })
  syncKey?: string | null;

  /** Agent-written chunks: which agent wrote it. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  agent?: string | null;

  // ── Index outbox ──────────────────────────────────────────────────────────

  @Index('idx_cl_chunks_embedding_pending', {
    where: `"embedding_status" <> 'success'`,
  })
  @Column({
    type: 'varchar',
    length: 16,
    name: 'embedding_status',
    default: ClEmbeddingStatus.PENDING,
  })
  embeddingStatus!: ClEmbeddingStatus;

  @Column({ type: 'int', name: 'embedding_attempts', default: 0 })
  embeddingAttempts!: number;

  @Column({ type: 'timestamp', name: 'embedded_at', nullable: true })
  embeddedAt?: Date | null;

  /** SHA-256 over every indexed field, so any edit re-embeds. */
  @Column({ type: 'varchar', length: 64, name: 'text_hash', nullable: true })
  textHash?: string | null;

  @Column({ type: 'int', name: 'index_version', nullable: true })
  indexVersion?: number | null;

  // ── Usage (recomputed by the loops; eval and preview traffic excluded) ────

  @Column({ type: 'int', name: 'times_retrieved', default: 0 })
  timesRetrieved!: number;

  @Column({ type: 'int', name: 'times_surfaced', default: 0 })
  timesSurfaced!: number;

  @Column({ type: 'int', name: 'times_applied', default: 0 })
  timesApplied!: number;

  @Column({ type: 'int', name: 'times_contradicted', default: 0 })
  timesContradicted!: number;

  @Column({ type: 'real', nullable: true })
  effectiveness?: number | null;

  @Column({ type: 'timestamp', name: 'last_retrieved_at', nullable: true })
  lastRetrievedAt?: Date | null;

  @Column({ type: 'timestamp', name: 'last_applied_at', nullable: true })
  lastAppliedAt?: Date | null;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'int', name: 'created_by', nullable: true })
  createdBy?: number | null;

  @Column({ type: 'int', name: 'edited_by', nullable: true })
  editedBy?: number | null;
}
