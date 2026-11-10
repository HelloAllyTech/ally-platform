import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One search, by any use case. Measurement, not mitigation: these rows are what the learning
 * loops grade, tune against and learn phrasings from. Written fire-and-forget — a failure to
 * log must never fail the search it describes.
 *
 * `querySensitive` rows hold a person's own words (a learner, or an admin describing
 * someone): stored, but withheld from every read surface and never turned into a learned
 * example query.
 */
@Entity('cl_retrievals')
@Index('idx_cl_retrievals_use_case_created', ['useCase', 'createdAt'])
export class ClRetrieval extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 40, name: 'use_case' })
  useCase!: string;

  @Column({ type: 'text', array: true, name: 'collections_searched' })
  collectionsSearched!: string[];

  /** Collections the caller asked for but may not read. Non-empty means the search was refused. */
  @Column({
    type: 'text',
    array: true,
    name: 'denied_collections',
    default: () => "'{}'",
  })
  deniedCollections!: string[];

  @Index('idx_cl_retrievals_session')
  @Column({ type: 'varchar', length: 80, name: 'session_id', nullable: true })
  sessionId?: string | null;

  @Column({ type: 'int', name: 'turn_index', nullable: true })
  turnIndex?: number | null;

  @Column({ type: 'text', array: true })
  queries!: string[];

  @Column({
    type: 'varchar',
    length: 24,
    name: 'query_origin',
    default: 'agent_tool',
  })
  queryOrigin!: string;

  @Column({ type: 'text', name: 'context_descriptor', nullable: true })
  contextDescriptor?: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  facets!: Record<string, unknown>;

  /** Audience used: the asker's organisation, or null for platform searches. */
  @Column({ type: 'jsonb', nullable: true })
  audience?: { tenantId: string | null } | null;

  /** The search setup in force (weights, re-rank, MMR λ…), so reports can compare setups. */
  @Column({ type: 'jsonb', name: 'search_setup', default: () => "'{}'::jsonb" })
  searchSetup!: Record<string, unknown>;

  @Column({ type: 'int', name: 'candidate_count', default: 0 })
  candidateCount!: number;

  @Column({ type: 'int', name: 'result_count', default: 0 })
  resultCount!: number;

  @Column({ type: 'varchar', length: 8, name: 'top_band', nullable: true })
  topBand?: string | null;

  @Column({ type: 'boolean', name: 'filter_backoff', default: false })
  filterBackoff!: boolean;

  @Column({ type: 'boolean', name: 'rerank_used', default: false })
  rerankUsed!: boolean;

  @Column({ type: 'boolean', name: 'cache_hit', default: false })
  cacheHit!: boolean;

  @Column({ type: 'jsonb', name: 'latency_ms', default: () => "'{}'::jsonb" })
  latencyMs!: Record<string, number>;

  @Column({ type: 'boolean', default: false })
  failed!: boolean;

  @Column({ type: 'boolean', name: 'query_sensitive', default: false })
  querySensitive!: boolean;

  /** Admin previews and evals: excluded from usage stats and effectiveness. */
  @Column({ type: 'boolean', name: 'exclude_from_usage', default: false })
  excludeFromUsage!: boolean;
}

/** Every candidate that reached re-ranking, shown or not — what makes per-retriever recall measurable. */
@Entity('cl_retrieval_hits')
@Index('idx_cl_retrieval_hits_retrieval', ['retrievalId'])
@Index('idx_cl_retrieval_hits_chunk', ['chunkId'])
export class ClRetrievalHit extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'retrieval_id' })
  retrievalId!: string;

  @Column({ type: 'uuid', name: 'chunk_id' })
  chunkId!: string;

  @Column({ type: 'varchar', length: 48, name: 'collection_id' })
  collectionId!: string;

  @Column({ type: 'int', name: 'bm25_rank', nullable: true })
  bm25Rank?: number | null;

  @Column({ type: 'int', name: 'statement_rank', nullable: true })
  statementRank?: number | null;

  @Column({ type: 'int', name: 'situations_rank', nullable: true })
  situationsRank?: number | null;

  @Column({ type: 'real', name: 'rrf_score' })
  rrfScore!: number;

  @Column({ type: 'smallint', name: 'rerank_grade', nullable: true })
  rerankGrade?: number | null;

  @Column({ type: 'varchar', length: 8 })
  band!: string;

  /** Why it was not shown, if it wasn't: `low_band`, `mmr`, `limit`, `inactive`, `audience`. */
  @Column({
    type: 'varchar',
    length: 16,
    name: 'dropped_reason',
    nullable: true,
  })
  droppedReason?: string | null;

  @Column({ type: 'int', name: 'final_rank', nullable: true })
  finalRank?: number | null;

  @Column({ type: 'boolean', default: false })
  surfaced!: boolean;

  @Column({ type: 'boolean', name: 'exploration_slot', default: false })
  explorationSlot!: boolean;
}

/**
 * What happened after retrieval. The learning loops read usage, not people: every signal here
 * comes from what agents and engineers actually did with a chunk.
 */
@Entity('cl_usage_events')
@Index('idx_cl_usage_events_chunk_type', ['chunkId', 'type'])
@Index('idx_cl_usage_events_session', ['sessionId'])
export class ClUsageEvent extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'chunk_id' })
  chunkId!: string;

  @Column({ type: 'varchar', length: 48, name: 'collection_id' })
  collectionId!: string;

  @Column({ type: 'varchar', length: 40, name: 'use_case' })
  useCase!: string;

  /**
   * `surfaced` · `read` · `probed` · `cited` · `applied_verified` · `cite_rejected` ·
   * `unused` · `shipped` · `agent_applied` · `agent_contradicted` · `not_relevant`
   */
  @Column({ type: 'varchar', length: 24 })
  type!: string;

  @Column({ type: 'varchar', length: 80, name: 'session_id', nullable: true })
  sessionId?: string | null;

  @Column({ type: 'uuid', name: 'retrieval_id', nullable: true })
  retrievalId?: string | null;

  @Column({ type: 'int', name: 'final_rank', nullable: true })
  finalRank?: number | null;

  @Column({ type: 'boolean', name: 'exploration_slot', default: false })
  explorationSlot!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  detail?: Record<string, unknown> | null;
}

/** Engineers' read-only MCP keys. Only the hash is stored; the key is shown once. */
@Entity('cl_reader_keys')
export class ClReaderKey extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_cl_reader_keys_owner')
  @Column({ type: 'int', name: 'owner_id' })
  ownerId!: number;

  @Column({ type: 'varchar', length: 80 })
  label!: string;

  @Index('uq_cl_reader_keys_hash', { unique: true })
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
