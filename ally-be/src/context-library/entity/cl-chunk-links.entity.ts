import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import {
  ClBulkUploadStatus,
  ClRelationOrigin,
  ClRelationType,
} from '../enum/context-library.enum';

/** Where a distilled chunk came from: document, section, pages. Location only, never text. */
@Entity('cl_chunk_sources')
@Index('uq_cl_chunk_sources', ['chunkId', 'sourceId', 'generation'], {
  unique: true,
})
export class ClChunkSource extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_cl_chunk_sources_chunk')
  @Column({ type: 'uuid', name: 'chunk_id' })
  chunkId!: string;

  @Index('idx_cl_chunk_sources_source')
  @Column({ type: 'uuid', name: 'source_id' })
  sourceId!: string;

  @Column({ type: 'int', default: 1 })
  generation!: number;

  @Column({ type: 'text', name: 'section_path', nullable: true })
  sectionPath?: string | null;

  @Column({ type: 'int', name: 'page_from', default: 0 })
  pageFrom!: number;

  @Column({ type: 'int', name: 'page_to', default: 0 })
  pageTo!: number;
}

/** How two chunks in the same collection relate. Tensions become trade-off cards. */
@Entity('cl_chunk_relations')
@Index('uq_cl_chunk_relations', ['fromId', 'toId', 'type'], { unique: true })
export class ClChunkRelation extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_cl_chunk_relations_from')
  @Column({ type: 'uuid', name: 'from_id' })
  fromId!: string;

  @Index('idx_cl_chunk_relations_to')
  @Column({ type: 'uuid', name: 'to_id' })
  toId!: string;

  @Column({ type: 'varchar', length: 16 })
  type!: ClRelationType;

  @Column({ type: 'text', nullable: true })
  note?: string | null;

  @Column({ type: 'varchar', length: 16 })
  origin!: ClRelationOrigin;

  @Column({ type: 'real', nullable: true })
  confidence?: number | null;
}

/** A snapshot before every edit, by a person or an agent curator. */
@Entity('cl_chunk_versions')
@Index('idx_cl_chunk_versions_chunk', ['chunkId', 'version'])
export class ClChunkVersion extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'chunk_id' })
  chunkId!: string;

  @Column({ type: 'int' })
  version!: number;

  @Column({ type: 'jsonb' })
  snapshot!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 40 })
  reason!: string;

  @Column({ type: 'int', name: 'edited_by', nullable: true })
  editedBy?: number | null;
}

/**
 * One bulk upload of authored chunks. The file is applied row by row and not stored; this
 * records what happened to each row.
 */
@Entity('cl_bulk_uploads')
export class ClBulkUpload extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 48, name: 'collection_id' })
  collectionId!: string;

  @Column({ type: 'text', name: 'file_name' })
  fileName!: string;

  @Column({ type: 'int', name: 'row_count' })
  rowCount!: number;

  @Column({ type: 'int', name: 'created_count', default: 0 })
  createdCount!: number;

  @Column({ type: 'int', name: 'updated_count', default: 0 })
  updatedCount!: number;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  rejected!: Array<{ row: number; reason: string }>;

  @Column({ type: 'varchar', length: 16 })
  status!: ClBulkUploadStatus;

  @Column({ type: 'uuid', name: 'owner_tenant_id', nullable: true })
  ownerTenantId?: string | null;

  @Column({ type: 'int', name: 'uploaded_by', nullable: true })
  uploadedBy?: number | null;
}
