import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/** A file kind Course Copilot can read as reference material. */
export type CourseCopilotSourceKind = 'pdf' | 'docx' | 'pptx';

/** One passage of a source, in reading order. */
export interface CourseCopilotSourceChunk {
  /** Position in the source, 0-based. */
  index: number;
  text: string;
  /** Page (PDF) or slide (PPTX) span; null when the format has neither. */
  pageFrom: number | null;
  pageTo: number | null;
  /** Heading trail or slide title, when the format carries one. */
  section: string | null;
}

/**
 * Reference material a trainer attached to one Course Copilot session: a partner's training
 * manual, slide deck or handout that the course should be built from.
 *
 * Belongs to the session, not the organisation — files are not shared between courses yet.
 * Only the extracted text is kept, already split into passages; the file itself is never stored.
 * Rows are hard-deleted when the trainer removes the file or archives the session, so a partner's
 * material does not outlive the course it was shared for.
 */
@Entity('course_copilot_sources')
@Index('idx_course_copilot_sources_session', ['sessionId'])
export class CourseCopilotSource extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sessionId!: string;

  /** The session's tenant, copied so a query can never cross organisations. */
  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId?: string | null;

  @Column({ type: 'varchar', length: 255 })
  fileName!: string;

  @Column({ type: 'varchar', length: 8 })
  kind!: CourseCopilotSourceKind;

  @Column({ type: 'int' })
  sizeBytes!: number;

  /** Pages (PDF) or slides (PPTX); null for formats without either. */
  @Column({ type: 'int', nullable: true })
  pageCount?: number | null;

  @Column({ type: 'int' })
  charCount!: number;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  chunks!: CourseCopilotSourceChunk[];

  @Column({ type: 'int', nullable: true })
  createdBy?: number | null;
}
