import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/** The closed list of faults the debrief language judge may report (ally-ai `ERROR_TYPES`). */
export const DEBRIEF_LANGUAGE_ERROR_TYPES = [
  'wrong_language',
  'script_mix',
  'untranslated_chunk',
  'quote_altered',
  'stiff_register',
  'literal_translation',
  'grammar_or_agreement',
  'meaning_drift',
] as const;
export type DebriefLanguageErrorType =
  (typeof DEBRIEF_LANGUAGE_ERROR_TYPES)[number];

export interface DebriefLanguageFinding {
  section: string;
  error_type: DebriefLanguageErrorType;
  evidence_quote: string;
  note: string;
}

/**
 * The language check on one debrief run (migration 1984700000000): findings
 * only, no score. One row per run: a re-judge replaces it. The share of
 * debriefs with a finding and the count per type are computed when read.
 */
@Entity('debrief_language_judgments')
@Index('debrief_language_judgments_run_uq', ['runId'], { unique: true })
export class DebriefLanguageJudgment extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  runId!: string;

  @Column({ type: 'varchar' })
  language!: string;

  @Column({ type: 'varchar' })
  judgeModel!: string;

  @Column({ type: 'varchar' })
  judgePromptVersion!: string;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  findings!: DebriefLanguageFinding[];

  @Column({ type: 'int', default: 0 })
  findingCount!: number;

  /** Distinct error types among the findings, for counting without opening the jsonb. */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  types!: string[];

  @Column({ type: 'timestamp', default: () => 'now()' })
  judgedAt!: Date;
}
