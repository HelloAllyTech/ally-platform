import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/** How the audit agent judged one answer. */
export type AnalyticsAuditVerdict =
  | 'correct'
  | 'minor_issues'
  | 'incorrect'
  | 'unverifiable';

export type AnalyticsAuditSeverity = 'high' | 'medium' | 'low';

/** The audit agent's finding for one answer. */
export interface AnalyticsAuditResult {
  verdict: AnalyticsAuditVerdict;
  /** Markdown: what was checked, what was found, the figures compared. */
  summary: string;
  /** Empty when the answer held up. */
  issues: { severity: AnalyticsAuditSeverity; description: string }[];
}

/**
 * One audited message inside an audit run: the question and answer as the
 * agent gave them, and what the auditor made of them.
 *
 * `audit` is null (with `error` set) when the auditor itself failed on this
 * message, so one bad run never discards the other messages' findings.
 */
export interface AnalyticsAuditedMessage {
  /** `analytics_agent_messages.id` this entry audits. No FK — it is a snapshot. */
  messageId: string;
  /** When the question was asked (ISO), so a number can be judged as of then. */
  askedAt: string;
  question: string;
  answer: string;
  audit: AnalyticsAuditResult | null;
  error?: string;
}

/**
 * Where a run is. `running` while its messages are still being audited,
 * `completed` once every one has an entry (a failed entry still counts — see
 * {@link AnalyticsAuditedMessage}), `failed` when the run itself died: the
 * tool connection broke, or the process went away mid-run.
 */
export type AnalyticsAuditStatus = 'running' | 'completed' | 'failed';

/** What started a run: someone pressing Start, or the shared scheduler. */
export type AnalyticsAuditTrigger = 'manual' | 'scheduled';

/**
 * One run of the Analytics Agent audit: the date it ran and the last N answered
 * messages with their audits.
 *
 * The run is a single row with its messages as a jsonb array, not a row per
 * message: a run is read and listed as a whole, and its entries are a snapshot
 * of the answers as they stood when audited. `messageId` inside each entry lets
 * a later run recognise a message it has already audited.
 *
 * The row is created when the run STARTS and each entry is appended as that
 * message finishes, so a reader can watch `messages.length` climb towards
 * `totalMessages`. Entries land in completion order, not asked order.
 *
 * At most one run is `running` at a time: a partial unique index (declared in
 * the migration — TypeORM cannot express it) makes a second start fail, which is
 * what stops two runs auditing the same message.
 *
 * Platform-scope, like the conversations it audits: no tenant column.
 */
@Entity('analytics_agent_audits')
@Index('idx_analytics_agent_audits_ran_at', ['ranAt'])
export class AnalyticsAgentAudit extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** When the run started. */
  @Column({ type: 'timestamptz' })
  ranAt!: Date;

  /** Plain varchar, no CHECK, so a new state never needs a migration. */
  @Column({ type: 'varchar', length: 16, default: 'completed' })
  status!: AnalyticsAuditStatus;

  /** Plain varchar, no CHECK. Rows from before the scheduler existed are `manual`. */
  @Column({ type: 'varchar', length: 16, default: 'manual' })
  trigger!: AnalyticsAuditTrigger;

  /** How many messages this run set out to audit — the progress denominator. */
  @Column({ type: 'int', default: 0 })
  totalMessages!: number;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  messages!: AnalyticsAuditedMessage[];
}
