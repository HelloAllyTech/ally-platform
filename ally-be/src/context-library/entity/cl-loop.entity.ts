import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import {
  ClGapKind,
  ClJudgmentSplit,
  ClLoop,
  ClLoopActionType,
} from '../enum/context-library.enum';

/**
 * One judge label: how well one chunk answered one logged search, 0–3.
 *
 * Graded by the platform's RAG-quality judge (a different model family from the re-ranker, so
 * the two don't share blind spots). Each search's whole pooled top 20 is judged, shown or not,
 * which is what lets the benchmark measure recall and not only precision.
 *
 * `split` is decided by a hash of the query, so the same wording always lands on the same side
 * and the holdout can never leak into what the loops learn from.
 */
@Entity('cl_judgments')
@Index('uq_cl_judgments_retrieval_chunk', ['retrievalId', 'chunkId'], {
  unique: true,
})
export class ClJudgment extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'retrieval_id' })
  retrievalId!: string;

  @Index('idx_cl_judgments_chunk')
  @Column({ type: 'uuid', name: 'chunk_id' })
  chunkId!: string;

  @Column({ type: 'varchar', length: 48, name: 'collection_id' })
  collectionId!: string;

  /** 3 directly useful · 2 useful · 1 same topic, doesn't answer · 0 unrelated. */
  @Column({ type: 'smallint' })
  grade!: number;

  /** Retrieved for its words, not its meaning. */
  @Column({ type: 'boolean', name: 'superficial_match', default: false })
  superficialMatch!: boolean;

  @Column({ type: 'varchar', length: 8 })
  split!: ClJudgmentSplit;

  /** Where the live search placed it (null: candidate not shown). */
  @Column({ type: 'int', name: 'final_rank', nullable: true })
  finalRank?: number | null;

  @Column({ type: 'varchar', length: 80, name: 'judge_model' })
  judgeModel!: string;

  @Column({ type: 'varchar', length: 40, name: 'judge_prompt_version' })
  judgePromptVersion!: string;
}

/**
 * Everything a loop did, with enough of the before-state to undo it. The Insights "What
 * changed?" feed reads this table; Undo restores `before` and stamps `undoneAt`.
 */
@Entity('cl_loop_actions')
@Index('idx_cl_loop_actions_collection_created', ['collectionId', 'createdAt'])
export class ClLoopAction extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 48, name: 'collection_id' })
  collectionId!: string;

  @Column({ type: 'varchar', length: 24 })
  loop!: ClLoop;

  @Column({ type: 'varchar', length: 24 })
  action!: ClLoopActionType;

  @Column({ type: 'uuid', name: 'chunk_id', nullable: true })
  chunkId?: string | null;

  /** Plain words for the feed: "Archived FP-0142: surfaced 41 times, judged off-topic 70%". */
  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'jsonb', nullable: true })
  before?: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  after?: Record<string, unknown> | null;

  /** The numbers behind the decision, for "Why?". */
  @Column({ type: 'jsonb', nullable: true })
  evidence?: Record<string, unknown> | null;

  @Column({ type: 'timestamp', name: 'undone_at', nullable: true })
  undoneAt?: Date | null;

  @Column({ type: 'int', name: 'undone_by', nullable: true })
  undoneBy?: number | null;
}

/**
 * A topic people searched for and didn't find. Sensitive queries contribute only to the count
 * and to the model-written label; their text is never copied here.
 */
@Entity('cl_gap_topics')
@Index('idx_cl_gap_topics_collection', ['collectionId', 'kind'])
export class ClGapTopic extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 48, name: 'collection_id' })
  collectionId!: string;

  @Column({ type: 'varchar', length: 16 })
  kind!: ClGapKind;

  /** Set for organisation gaps: whose entries are missing. */
  @Column({ type: 'uuid', name: 'tenant_id', nullable: true })
  tenantId?: string | null;

  @Column({ type: 'varchar', length: 160 })
  label!: string;

  @Column({ type: 'int', name: 'query_count' })
  queryCount!: number;

  /** Up to five non-sensitive example searches. Empty when every query was sensitive. */
  @Column({
    type: 'text',
    array: true,
    name: 'example_queries',
    default: () => "'{}'",
  })
  exampleQueries!: string[];

  @Column({ type: 'timestamp', name: 'first_seen_at' })
  firstSeenAt!: Date;

  @Column({ type: 'timestamp', name: 'last_seen_at' })
  lastSeenAt!: Date;

  /** `open` until a later run finds the topic answered, or an admin dismisses it. */
  @Column({ type: 'varchar', length: 12, default: 'open' })
  status!: 'open' | 'answered' | 'dismissed';
}
