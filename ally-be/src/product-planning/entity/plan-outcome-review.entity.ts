import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type PlanOutcomeVerdict =
  | 'hit'
  | 'partial'
  | 'miss'
  | 'too_early'
  | 'measurement_broken';

/**
 * One outcome review of a shipped plan, at one of the dates its success
 * measure set (rev 5.2 §B.5 Learn). Idempotent per (session, dueDate).
 * The review is also written into the Context Library's Product Outcomes
 * collection so later plans can find it (`chunkCode`).
 */
@Entity('plan_outcome_reviews')
@Index('uq_plan_outcome_reviews_session_due', ['sessionId', 'dueDate'], {
  unique: true,
})
export class PlanOutcomeReview {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sessionId!: string;

  @Column({ type: 'date' })
  dueDate!: string;

  @Column({ type: 'varchar', length: 20 })
  verdict!: PlanOutcomeVerdict;

  /** What was measured: the method's answer, quoted. */
  @Column({ type: 'text' })
  observed!: string;

  @Column({ type: 'text' })
  reasons!: string;

  /** Suggested next steps for the lead; never filed automatically. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  nextSteps!: string[];

  @Column({ type: 'varchar', length: 32, nullable: true })
  chunkCode?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
