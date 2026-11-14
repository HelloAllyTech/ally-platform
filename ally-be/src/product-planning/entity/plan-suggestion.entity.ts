import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type PlanSuggestionStatus = 'open' | 'dismissed' | 'worked_up';

/**
 * One idea the weekly signal scout suggests from aggregated product signals
 * (rev 5.2 §B.8.3, P10). Shown to Leads in the Signals tab; never filed by the
 * agent. Working one up starts a private plan for the Lead who chose it;
 * dismissing one suppresses the same suggestion (by `fingerprint`) for 90 days.
 */
@Entity('plan_suggestions')
@Index('idx_plan_suggestions_status', ['status', 'createdAt'])
export class PlanSuggestion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'text' })
  problem!: string;

  @Column({ type: 'text' })
  who!: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  evidence!: string[];

  @Column({ type: 'text' })
  whyNow!: string;

  /** Normalised title, for dismissal suppression and de-duplication. */
  @Column({ type: 'varchar', length: 64 })
  fingerprint!: string;

  @Column({ type: 'varchar', length: 12, default: 'open' })
  status!: PlanSuggestionStatus;

  @Column({ type: 'int', nullable: true })
  decidedBy?: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt?: Date | null;

  /** The private plan a Lead started from it. */
  @Column({ type: 'uuid', nullable: true })
  sessionId?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
