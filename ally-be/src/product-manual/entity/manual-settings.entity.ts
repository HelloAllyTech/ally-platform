import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Summary the last weekly run leaves on the settings row. */
export interface ManualLastRun {
  runId: string;
  at: string;
  status: string;
  pagesTouched: number;
  proposalsApplied: number;
  spentUsd: number;
  note?: string;
}

/**
 * Singleton settings for the Product Manual's weekly agent (id = 1, CHECK in the migration).
 * Seeded OFF: nothing runs and nothing is spent until an admin turns it on.
 */
@Entity('manual_settings')
export class ManualSettings {
  @PrimaryColumn({ type: 'int', default: 1 })
  id!: number;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  /** USD per IST calendar month across the weekly agent and chat-driven edits. */
  @Column({
    name: 'monthly_budget_usd',
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: 100,
  })
  monthlyBudgetUsd!: string;

  /** ISO date (IST) the scheduled run last claimed, so a week runs once. */
  @Column({ name: 'last_run_date', type: 'date', nullable: true })
  lastRunDate?: string | null;

  @Column({ name: 'last_run', type: 'jsonb', nullable: true })
  lastRun?: ManualLastRun | null;

  @Column({ name: 'updated_by', type: 'int', nullable: true })
  updatedBy?: number | null;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}
