import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import {
  ClSegmentRunStatus,
  ClSegmentStatus,
} from '../enum/context-library.enum';

/**
 * One heading-bounded piece of an uploaded document. NO TEXT: the text sits in Redis
 * (`cl:segment:{id}`) for at most a day and is deleted once every target collection has
 * extracted it. This row is what survives — enough to show progress and say where a chunk
 * came from.
 */
@Entity('cl_ingest_segments')
@Index('uq_cl_ingest_segments_source_ordinal', ['sourceId', 'ordinal'], {
  unique: true,
})
export class ClIngestSegment extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'source_id' })
  sourceId!: string;

  @Column({ type: 'int' })
  ordinal!: number;

  @Column({ type: 'text', name: 'section_path', nullable: true })
  sectionPath?: string | null;

  @Column({ type: 'int', name: 'page_from', default: 0 })
  pageFrom!: number;

  @Column({ type: 'int', name: 'page_to', default: 0 })
  pageTo!: number;

  @Column({ type: 'varchar', length: 64, name: 'text_hash' })
  textHash!: string;

  @Column({ type: 'int', name: 'token_count', default: 0 })
  tokenCount!: number;

  /** Opening or closing material, read by the overview pass. */
  @Column({ type: 'boolean', name: 'for_overview', default: false })
  forOverview!: boolean;

  @Column({ type: 'varchar', length: 16 })
  status!: ClSegmentStatus;

  @Column({
    type: 'varchar',
    length: 40,
    name: 'skipped_reason',
    nullable: true,
  })
  skippedReason?: string | null;
}

/**
 * One segment × one target collection: the unit of work the worker claims. A document fed to
 * two collections is extracted twice from the same segments, each with its own profile.
 */
@Entity('cl_segment_runs')
@Index('uq_cl_segment_runs_segment_collection', ['segmentId', 'collectionId'], {
  unique: true,
})
@Index('idx_cl_segment_runs_claim', ['status', 'queuePosition', 'ordinal'])
export class ClSegmentRun extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'segment_id' })
  segmentId!: string;

  @Column({ type: 'uuid', name: 'source_id' })
  sourceId!: string;

  @Column({ type: 'varchar', length: 48, name: 'collection_id' })
  collectionId!: string;

  /** Copied from the source so the claim query needs no join. */
  @Column({ type: 'bigint', name: 'queue_position' })
  queuePosition!: string;

  @Column({ type: 'int' })
  ordinal!: number;

  @Column({ type: 'varchar', length: 16 })
  status!: ClSegmentRunStatus;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'timestamp', name: 'claimed_at', nullable: true })
  claimedAt?: Date | null;

  @Column({ type: 'text', nullable: true })
  error?: string | null;

  @Column({ type: 'int', name: 'candidates_found', default: 0 })
  candidatesFound!: number;

  @Column({ type: 'int', name: 'candidates_kept', default: 0 })
  candidatesKept!: number;

  /**
   * What happened to each candidate, by outcome (`published`, `low`, `merged`, or a rejection
   * reason). Kept per run and summed for the yield report, so concurrent runs of one document
   * never race on a shared counter.
   */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  outcomes!: Record<string, number>;
}
