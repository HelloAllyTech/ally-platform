import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * Where a weekly automation run is. `running` while the two agents that start
 * with it (backend review, PostHog events) are working; `completed` once both
 * have ended; `failed` when the run itself died (the process went away).
 *
 * The dbt agent is deliberately NOT part of this state: it waits, possibly for
 * days, on a pull request a person merges, so its progress lives on its own
 * `analytics_automation_agent_runs` row.
 */
export type AnalyticsAutomationRunStatus = 'running' | 'completed' | 'failed';

/** Only the scheduler starts runs; kept as a column so that can change. */
export type AnalyticsAutomationTrigger = 'scheduled' | 'manual';

/** The commits one run looked at, so "what changed since last time" is exact. */
export interface AnalyticsAutomationCommitShas {
  platform: {
    /** Head of the previous run, or null on the first run. */
    base: string | null;
    head: string;
    /** Lower bound used to list commits when no `base` is known (ISO). */
    since: string;
  };
  dbt: { head: string };
}

/**
 * One weekly run of the Analytics Automation agents: when it started, and the
 * commit SHAs every agent in it saw (taken once, at the start, so all three
 * agents judge the same code). The per-agent results are
 * `analytics_automation_agent_runs` rows.
 *
 * At most one run is `running` at a time (partial unique index, declared in the
 * migration). Platform-scope: no tenant column.
 */
@Entity('analytics_automation_runs')
@Index('idx_analytics_automation_runs_ran_at', ['ranAt'])
export class AnalyticsAutomationRun extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** When the run started. */
  @Column({ type: 'timestamptz' })
  ranAt!: Date;

  /** When the two starting agents ended; null while `running`. */
  @Column({ type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;

  /** Plain varchar, no CHECK, so a new state never needs a migration. */
  @Column({ type: 'varchar', length: 16, default: 'running' })
  status!: AnalyticsAutomationRunStatus;

  @Column({ type: 'varchar', length: 16, default: 'scheduled' })
  trigger!: AnalyticsAutomationTrigger;

  @Column({ type: 'jsonb' })
  commitShas!: AnalyticsAutomationCommitShas;
}
