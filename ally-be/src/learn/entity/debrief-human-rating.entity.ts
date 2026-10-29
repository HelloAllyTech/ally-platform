import { BaseEntity } from 'src/common/entity/base.entity';
import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * One person's score of one debrief, on the debrief-quality rubric.
 *
 * The calibration set the independent judge is checked against: judge-vs-human
 * κ on accuracy, evidence and the missed-risk-cue hard fail is the standing
 * gate on the debrief Improver's autonomy. Raters see a redacted transcript
 * and the debrief, never the judge's scores.
 */
@Unique('debrief_human_ratings_session_rater_uq', [
  'scenarioSessionId',
  'raterId',
  'rubricVersion',
])
@Entity('debrief_human_ratings')
export class DebriefHumanRating extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  scenarioSessionId!: string;

  @Column()
  raterId!: number;

  @Column({ default: 'v1' })
  rubricVersion!: string;

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

  /** Hard-fail codes the rater found (`fabricated_quote`, `missed_risk_cue`, …). */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  hardFails!: string[];

  @Column({ type: 'text', nullable: true })
  note?: string;
}
