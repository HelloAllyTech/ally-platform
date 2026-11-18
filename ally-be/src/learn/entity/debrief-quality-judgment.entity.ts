import { BaseEntity } from 'src/common/entity/base.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * One learner debrief, scored by the independent debrief-quality judge.
 *
 * The groundedness judge asks whether each claim in a debrief is TRUE; this
 * asks how good the debrief is AS A DEBRIEF — specific, actionable, safe and
 * well prioritised — on the rubric's eight dimensions. It is the score the
 * "8 out of 10" bar is read from.
 *
 * The row holds the judge's labels only: eight 0-10 scores and the hard fails.
 * The weighted overall is computed at read time from
 * `analytics/constants/debrief-quality.constants.ts`, so a weight can change
 * without re-judging anything.
 *
 * Slice columns (language, workerType, learnerTurns, scenarioId, llmModel,
 * occurredAt) are denormalised so the baseline can be cut by language × level ×
 * session length with a single-table query.
 *
 * Unique per (session, judgeModel, judgePromptVersion): a new rubric version
 * writes alongside rather than over the old one, and a re-run is idempotent.
 */
@Index('debrief_quality_judgment_session_id_idx', ['scenarioSessionId'])
@Index('debrief_quality_judgment_occurred_at_idx', ['occurredAt'])
@Unique('debrief_quality_judgment_session_judge_uq', [
  'scenarioSessionId',
  'judgeModel',
  'judgePromptVersion',
])
@Entity('debrief_quality_judgment')
export class DebriefQualityJudgment extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  scenarioSessionId!: string;

  /**
   * Which debrief was scored: `supervisor_note` (the markdown note the apps
   * render) or `lists` (older debriefs with only positives and areas of growth).
   */
  @Column()
  debriefSource!: string;

  /** What wrote the debrief: `scenario_evaluation` today, `debrief_v2` later. */
  @Column()
  generator!: string;

  // The rubric's eight dimensions, 0-10 each --------------------------------
  @Column({ type: 'smallint' })
  evidenceSpecificity!: number;

  @Column({ type: 'smallint' })
  accuracy!: number;

  @Column({ type: 'smallint' })
  actionability!: number;

  @Column({ type: 'smallint' })
  prioritisation!: number;

  @Column({ type: 'smallint' })
  personalisationProgress!: number;

  @Column({ type: 'smallint' })
  practiceAlignment!: number;

  @Column({ type: 'smallint' })
  tone!: number;

  @Column({ type: 'smallint' })
  clarity!: number;

  /** `[{code, evidence}]`; any entry caps the overall at 4. */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  hardFails!: Array<{ code: string; evidence: string }>;

  /** One sentence per dimension, keyed by dimension name. */
  @Column({ type: 'jsonb', nullable: true })
  reasoning?: Record<string, string>;

  /** The debrief text exactly as judged, anchors resolved to turn numbers. */
  @Column({ type: 'text', nullable: true })
  debriefText?: string;

  // Denormalised slice dimensions ------------------------------------------
  @Column({ nullable: true })
  language?: string;

  /** LAY | EARLY_PROFESSIONAL | EXPERIENCED_PROFESSIONAL */
  @Column({ nullable: true })
  workerType?: string;

  /** Learner messages in the session: the "session length" slice. */
  @Column({ type: 'int', nullable: true })
  learnerTurns?: number;

  @Column({ nullable: true })
  scenarioId?: number;

  @Column({ type: 'uuid', nullable: true })
  scenarioVersionId?: string;

  /** The roleplay actor's model, as on the other judgment tables. */
  @Column({ nullable: true })
  llmModel?: string;

  @Column({ type: 'timestamp', nullable: true })
  occurredAt?: Date;

  // Judge provenance --------------------------------------------------------
  @Column()
  judgeModel!: string;

  @Column({ default: 'v1' })
  judgePromptVersion!: string;
}
