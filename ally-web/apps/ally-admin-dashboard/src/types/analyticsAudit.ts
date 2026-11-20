/**
 * Analytics Agent audit — types mirroring ally-be's `/v1/analytics/agent/audits`
 * DTOs.
 *
 * An audit is a background run: an auditor agent re-checks the Analytics Agent's
 * recent answers against the data, the dbt docs and the product code. It takes
 * minutes, so starting one returns at once with the run `running`, and the tab
 * polls it while entries arrive — each message's finding is saved as it finishes.
 */

export type AnalyticsAuditStatus = "running" | "completed" | "failed";

/** What started a run: someone pressing Start, or the scheduler. */
export type AnalyticsAuditTrigger = "manual" | "scheduled";

/** The auditor's judgement of one answer. */
export type AnalyticsAuditVerdict = "correct" | "minor_issues" | "incorrect" | "unverifiable";

export type AnalyticsAuditSeverity = "high" | "medium" | "low";

/** A verdict key in `verdictCounts`: the four verdicts, plus `error` for a
 *  message the auditor itself failed on. */
export type AnalyticsAuditCountKey = AnalyticsAuditVerdict | "error";

export interface AnalyticsAuditIssue {
  severity: AnalyticsAuditSeverity;
  description: string;
}

export interface AnalyticsAuditResult {
  verdict: AnalyticsAuditVerdict;
  /** Markdown: what was checked and the figures compared. */
  summary: string;
  /** Empty when the answer held up. */
  issues: AnalyticsAuditIssue[];
}

/** One audited message: the question and answer as the agent gave them, and the finding. */
export interface AnalyticsAuditedMessage {
  messageId: string;
  /** When the question was asked (ISO) — an answer is judged as of then. */
  askedAt: string;
  question: string;
  answer: string;
  /** Null when the auditor failed on this message; `error` says why. */
  audit: AnalyticsAuditResult | null;
  error?: string;
}

/** A run as listed in the sidebar. */
export interface AnalyticsAuditSummary {
  id: string;
  /** When the run started (ISO). */
  ranAt: string;
  status: AnalyticsAuditStatus;
  trigger: AnalyticsAuditTrigger;
  /** How many messages the run set out to audit. */
  totalMessages: number;
  /** How many have a finding so far; reaches `totalMessages` when it completes. */
  completedMessages: number;
  /** Entries per verdict; absent keys are zero. */
  verdictCounts: Partial<Record<AnalyticsAuditCountKey, number>>;
}

export interface AnalyticsAuditDetail extends AnalyticsAuditSummary {
  /** Finished so far, in the order the questions were asked. */
  messages: AnalyticsAuditedMessage[];
}

export interface StartAnalyticsAuditRequest {
  /** How many of the most recent answered messages to consider. */
  messageCount: number;
}

export interface StartAnalyticsAuditResponse {
  /** The run that started, or null when every recent message was already audited. */
  audit: AnalyticsAuditSummary | null;
}
