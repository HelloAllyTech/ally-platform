import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { ClSourceKind, ClSourceStatus } from '../enum/context-library.enum';

export interface ClCollectionYield {
  candidates: number;
  published: number;
  publishedLowConfidence: number;
  merged: number;
  rejected: Record<string, number>;
  overCap: number;
}

/**
 * One uploaded document. The file itself is never stored: it is read in memory, segmented,
 * and dropped. What remains is enough to recognise the same file again (the hash), report on
 * it (the yield), and say where a chunk came from (title, version, year).
 *
 * No author, publisher or contributor names, by decision — they are discarded at extraction.
 */
@Entity('cl_sources')
export class ClSource extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'varchar', length: 64, name: 'doc_version', nullable: true })
  docVersion?: string | null;

  @Column({ type: 'int', nullable: true })
  year?: number | null;

  @Column({ type: 'varchar', length: 16 })
  kind!: ClSourceKind;

  @Column({ type: 'varchar', length: 16, nullable: true })
  language?: string | null;

  /**
   * SHA-256 of the uploaded bytes. A retired Knowledge Base corpus's documents have no file:
   * theirs is SHA-256 of `kb_migration:<corpus>:<kb document id>`, which is what makes the
   * import idempotent (see ContextKbImportService).
   */
  @Index('idx_cl_sources_file_hash')
  @Column({ type: 'varchar', length: 64, name: 'file_hash', nullable: true })
  fileHash?: string | null;

  /** Normalised title, to catch the same document uploaded as both PDF and EPUB. */
  @Column({ type: 'text', name: 'title_key' })
  titleKey!: string;

  /** ≤ 150 words of our own about what the document covers. Names no people or organisations. */
  @Column({ type: 'text', nullable: true })
  overview?: string | null;

  /**
   * `pending` until one worker claims the overview (`running`), so concurrent workers never
   * write it twice; `skipped` for documents too short to need one.
   */
  @Column({
    type: 'varchar',
    length: 16,
    name: 'overview_state',
    default: 'pending',
  })
  overviewState!: 'pending' | 'running' | 'done' | 'skipped' | 'failed';

  @Column({ type: 'jsonb', name: 'key_terms', nullable: true })
  keyTerms?: Array<{ term: string; meaning: string }> | null;

  @Column({ type: 'text', array: true, name: 'target_collections' })
  targetCollections!: string[];

  /** Set when an organisation admin uploads into an organisation-owned collection. */
  @Column({ type: 'uuid', name: 'owner_tenant_id', nullable: true })
  ownerTenantId?: string | null;

  /**
   * Who the chunks distilled from this document reach: every organisation, or only those in
   * `tenantIds`. Chosen by a platform admin at upload and changeable later; an organisation
   * admin's document reaches their own organisation only.
   */
  @Column({ type: 'boolean', name: 'is_global', default: true })
  isGlobal!: boolean;

  @Column({
    type: 'text',
    array: true,
    name: 'tenant_ids',
    default: () => "'{}'",
  })
  tenantIds!: string[];

  /** Collections whose consolidation has been claimed, so it runs exactly once each. */
  @Column({
    type: 'text',
    array: true,
    name: 'consolidated_collections',
    default: () => "'{}'",
  })
  consolidatedCollections!: string[];

  @Column({ type: 'int', name: 'page_count', default: 0 })
  pageCount!: number;

  @Column({ type: 'int', name: 'segment_count', default: 0 })
  segmentCount!: number;

  @Column({
    type: 'jsonb',
    name: 'extraction_warnings',
    default: () => "'[]'::jsonb",
  })
  extractionWarnings!: string[];

  @Index('idx_cl_sources_status')
  @Column({ type: 'varchar', length: 16 })
  status!: ClSourceStatus;

  @Column({ type: 'uuid', name: 'batch_id', nullable: true })
  batchId?: string | null;

  /** Distilling order. Lower goes first; reorderable. */
  @Column({ type: 'bigint', name: 'queue_position' })
  queuePosition!: string;

  @Column({ type: 'timestamp', name: 'paused_at', nullable: true })
  pausedAt?: Date | null;

  /** Per target collection. */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  yield!: Record<string, ClCollectionYield>;

  @Column({
    type: 'varchar',
    length: 80,
    name: 'distill_model',
    nullable: true,
  })
  distillModel?: string | null;

  @Column({
    type: 'jsonb',
    name: 'prompt_versions',
    default: () => "'{}'::jsonb",
  })
  promptVersions!: Record<string, string>;

  @Column({ type: 'int', name: 'input_tokens', default: 0 })
  inputTokens!: number;

  @Column({ type: 'int', name: 'output_tokens', default: 0 })
  outputTokens!: number;

  @Column({ type: 'int', name: 'cached_input_tokens', default: 0 })
  cachedInputTokens!: number;

  @Column({
    type: 'numeric',
    precision: 10,
    scale: 4,
    name: 'cost_usd',
    default: 0,
  })
  costUsd!: string;

  @Column({
    type: 'numeric',
    precision: 10,
    scale: 4,
    name: 'cost_cap_usd',
    nullable: true,
  })
  costCapUsd?: string | null;

  @Column({ type: 'int', default: 1 })
  generation!: number;

  @Column({ type: 'text', nullable: true })
  error?: string | null;

  @Column({ type: 'int', name: 'uploaded_by', nullable: true })
  uploadedBy?: number | null;
}
