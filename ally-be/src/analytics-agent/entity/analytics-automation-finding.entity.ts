import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

export type AnalyticsAutomationFindingKind = 'posthog_event' | 'dbt_change';

/**
 * `proposed` — the agent suggested it; `included` — it is in the pull request;
 * `dropped` — the agent suggested it but server-side checks refused it (the
 * reason is in `detail`); `rejected` — a person rejected the proposal it was in.
 */
export type AnalyticsAutomationFindingStatus =
  | 'proposed'
  | 'included'
  | 'dropped'
  | 'rejected';

/**
 * One item an agent found: a PostHog event it wants to add, or a change dbt
 * needs. Approval is per agent run (one proposal, one decision), so the
 * decision lives on the agent run; a finding's `status` follows it.
 *
 * `fingerprint` is a stable hash of what the item IS (not of the wording), so
 * the dbt agent can recognise an item a person already rejected and not raise
 * it again next week.
 */
@Entity('analytics_automation_findings')
@Index('idx_analytics_automation_findings_agent_run', ['agentRunId'])
@Index('idx_analytics_automation_findings_fingerprint', ['fingerprint'])
export class AnalyticsAutomationFinding extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** FK → `analytics_automation_agent_runs` ON DELETE CASCADE (migration). */
  @Column({ type: 'uuid' })
  agentRunId!: string;

  @Column({ type: 'varchar', length: 32 })
  kind!: AnalyticsAutomationFindingKind;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  detail!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  payload!: Record<string, any>;

  @Column({ type: 'varchar', length: 64 })
  fingerprint!: string;

  @Column({ type: 'varchar', length: 16, default: 'proposed' })
  status!: AnalyticsAutomationFindingStatus;
}
