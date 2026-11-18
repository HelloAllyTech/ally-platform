import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../common/entity/base.entity';

/**
 * One Scribe v2 note-harness run for a chat (docs/scribe-v2/DESIGN.md §6).
 *
 * In shadow mode the harness runs after the v1 summary is delivered and its
 * output lands here only, for side-by-side comparison; nothing reads it into
 * the counsellor's note. The columns other than `draft` are the run's numbers
 * (no content), so they can be aggregated without touching PHI.
 */
@Entity('scribe_note_drafts')
@Index('idx_scribe_note_drafts_chatId', ['chatId'])
@Index('idx_scribe_note_drafts_created', ['createdAt'])
export class ScribeNoteDraft extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'integer' })
  chatId!: number;

  /** True while v2 runs beside v1 without being shown. */
  @Column({ default: true })
  shadow!: boolean;

  /** SCRIBE or DICTATION. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  mode?: string | null;

  /** `single` (one pass) or `map_reduce` (long session split into parts). */
  @Column({ type: 'varchar', length: 20, nullable: true })
  path?: string | null;

  @Column({ type: 'integer', default: 0 })
  segments!: number;

  @Column({ type: 'integer', default: 0 })
  llmCalls!: number;

  @Column({ default: false })
  repaired!: boolean;

  @Column({ type: 'integer', nullable: true })
  durationMs?: number | null;

  @Column({ type: 'real', nullable: true })
  transcriptMinutes?: number | null;

  @Column({ type: 'integer', nullable: true })
  transcriptWords?: number | null;

  /** The budget's narrative target, and what the draft actually wrote. */
  @Column({ type: 'integer', nullable: true })
  narrativeWordsTarget?: number | null;

  @Column({ type: 'integer', nullable: true })
  narrativeWords?: number | null;

  @Column({ type: 'integer', nullable: true })
  narrativePoints?: number | null;

  @Column({ type: 'integer', nullable: true })
  fieldsFilled?: number | null;

  /** Budget, and validation results (reordered, dropped fields and why). */
  @Column({ type: 'jsonb', nullable: true })
  budget?: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  validation?: Record<string, unknown> | null;

  /** The draft itself: { narrative: [...], fields: {...} }. Contains PHI. */
  @Column({ type: 'jsonb', nullable: true })
  draft?: Record<string, unknown> | null;

  /**
   * `canonical`: STT segments with speaker roles, never rewritten (DESIGN §5).
   * `diarized`: the v1 LLM-rewritten turns (fallback).
   */
  @Column({ type: 'varchar', length: 20, nullable: true })
  transcriptSource?: string | null;

  /**
   * The turns the draft's turn ids point into: [{id, speaker, start, end,
   * text}]. Contains PHI.
   */
  @Column({ type: 'jsonb', nullable: true })
  transcript?: Record<string, unknown>[] | null;

  @Column({ type: 'text', nullable: true })
  error?: string | null;

  @Column({ type: 'varchar', nullable: true })
  correlationId?: string | null;
}
