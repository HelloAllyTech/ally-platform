import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/** The three agents of a weekly run. */
export type AnalyticsAutomationAgentName =
  | 'backend_review'
  | 'posthog_events'
  | 'dbt_metrics';

/**
 * Where one agent is. Plain strings with no CHECK, like every state column in
 * this module.
 *
 * - `backend_review`, `posthog_events`: `running` → `completed` | `failed`.
 * - `dbt_metrics`: `waiting` (the PostHog PR is still open) → `analysing` →
 *   `awaiting_approval` (a proposal for a person) → `applying` → `pr_opened`;
 *   or `rejected`; or `completed` when nothing in dbt needs to change; or
 *   `failed`.
 */
export type AnalyticsAutomationAgentStatus =
  | 'running'
  | 'waiting'
  | 'analysing'
  | 'awaiting_approval'
  | 'applying'
  | 'pr_opened'
  | 'rejected'
  | 'completed'
  | 'failed';

export type AnalyticsAutomationPrState = 'open' | 'merged' | 'closed';

export type AnalyticsAutomationDecision = 'approved' | 'rejected';

/** What the review agent made of a pull request. */
export type AnalyticsAutomationReviewVerdict =
  | 'approve'
  | 'concerns'
  | 'reject';

/**
 * One agent's work inside one run.
 *
 * `summary` is the markdown a reader sees (for the backend review it IS the
 * result); `output` keeps the structured form. The pull request the agent
 * opened, if any, and the review agent's verdict on it, sit on the row because
 * an agent opens at most one.
 *
 * Unique on (`runId`, `agent`): a run has exactly one row per agent, which is
 * what makes a retry or a double poll idempotent.
 */
@Entity('analytics_automation_agent_runs')
@Unique('uq_analytics_automation_agent_runs_run_agent', ['runId', 'agent'])
@Index('idx_analytics_automation_agent_runs_pr_state', ['prState'])
export class AnalyticsAutomationAgentRun extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** FK → `analytics_automation_runs` ON DELETE CASCADE (migration). */
  @Column({ type: 'uuid' })
  runId!: string;

  @Column({ type: 'varchar', length: 32 })
  agent!: AnalyticsAutomationAgentName;

  @Column({ type: 'varchar', length: 24 })
  status!: AnalyticsAutomationAgentStatus;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;

  /** Markdown shown to the reader. */
  @Column({ type: 'text', nullable: true })
  summary!: string | null;

  /** The agent's structured result. Shape depends on `agent`. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  // `any` values: TypeORM's update() typing cannot take Record<string, unknown>.
  output!: Record<string, any>;

  /** Why the agent failed, or why it is waiting / skipped. Never user text. */
  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  prRepo!: string | null;

  @Column({ type: 'int', nullable: true })
  prNumber!: number | null;

  @Column({ type: 'text', nullable: true })
  prUrl!: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  prState!: AnalyticsAutomationPrState | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  reviewVerdict!: AnalyticsAutomationReviewVerdict | null;

  @Column({ type: 'text', nullable: true })
  reviewSummary!: string | null;

  /** Approve / reject by a person. Only the dbt agent asks for one. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  decision!: AnalyticsAutomationDecision | null;

  @Column({ type: 'int', nullable: true })
  decidedBy!: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt!: Date | null;
}
