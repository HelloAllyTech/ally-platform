/**
 * Analytics Automation — types mirroring ally-be's
 * `/v1/analytics/agent/automation` DTOs.
 *
 * Once a week the server runs two agents: a PostHog events agent (opens a pull
 * request) and a dbt agent. The dbt agent first works out what changed in the
 * platform (the "Metrics / Definition changes" section) and plans its dbt
 * changes, both read-only and before any approval. It edits the dbt repo only
 * after a person approves and the PostHog pull request is merged or closed. Runs
 * are started by the scheduler only; the tab reads them and approves or rejects
 * the dbt plan.
 */

export type AnalyticsAutomationRunStatus = "running" | "completed" | "failed";

export type AnalyticsAutomationAgentName = "posthog_events" | "dbt_metrics";

/** `running`/`completed`/`failed` for the PostHog agent; the rest are the dbt agent's steps. */
export type AnalyticsAutomationAgentStatus =
  | "running"
  | "waiting"
  | "analysing"
  | "awaiting_approval"
  | "applying"
  | "pr_opened"
  | "rejected"
  | "completed"
  | "failed";

export type AnalyticsAutomationPrState = "open" | "merged" | "closed";
export type AnalyticsAutomationReviewVerdict = "approve" | "concerns" | "reject";
export type AnalyticsAutomationFindingStatus = "proposed" | "included" | "dropped" | "rejected";
export type AnalyticsAutomationFindingKind = "posthog_event" | "dbt_change";

export interface AnalyticsAutomationPullRequest {
  repo: string;
  number: number;
  url: string;
  state: AnalyticsAutomationPrState;
}

export interface AnalyticsAutomationReview {
  /** Null when the review agent itself failed. */
  verdict: AnalyticsAutomationReviewVerdict | null;
  summary: string;
}

export interface AnalyticsAutomationFinding {
  id: string;
  kind: AnalyticsAutomationFindingKind;
  title: string;
  detail: string | null;
  payload: Record<string, unknown>;
  status: AnalyticsAutomationFindingStatus;
}

export interface AnalyticsAutomationAgentRun {
  id: string;
  agent: AnalyticsAutomationAgentName;
  status: AnalyticsAutomationAgentStatus;
  startedAt: string | null;
  finishedAt: string | null;
  /** Markdown shown to the reader. */
  summary: string | null;
  /** Why the agent is waiting, or why it failed. */
  note: string | null;
  output: Record<string, unknown>;
  pullRequest: AnalyticsAutomationPullRequest | null;
  review: AnalyticsAutomationReview | null;
  decision: "approved" | "rejected" | null;
  decidedAt: string | null;
  canApprove: boolean;
  canReject: boolean;
  findings: AnalyticsAutomationFinding[];
}

/**
 * One thing that changed in the platform, from the dbt agent's analysis. Stored
 * in the dbt agent's `output.definitionChanges`.
 */
export interface AnalyticsAutomationDefinitionChange {
  area: "database" | "metric_definition" | "enum" | "other";
  title: string;
  description: string;
  sourcePaths: string[];
  /** True when dbt would be wrong or stale without a change. */
  affectsDbt: boolean;
}

/**
 * Where the dbt pull request's CI is, from the dbt agent's `output.ci`. While
 * the agent watches CI it is `running` or `fixing` (the agent pushes fixes to the
 * same branch when a check fails); the rest are outcomes.
 */
export type AnalyticsAutomationCiState =
  | "running"
  | "fixing"
  | "green"
  | "failed"
  | "none"
  | "timeout"
  | "stopped"
  | "unreadable";

export interface AnalyticsAutomationCi {
  state: AnalyticsAutomationCiState;
  /** Fix attempts made so far. */
  attempts: number;
  message: string;
  failedChecks: string[];
}

export interface AnalyticsAutomationRunSummary {
  id: string;
  ranAt: string;
  finishedAt: string | null;
  status: AnalyticsAutomationRunStatus;
  agents: { agent: AnalyticsAutomationAgentName; status: AnalyticsAutomationAgentStatus }[];
}

export interface AnalyticsAutomationRunDetail extends AnalyticsAutomationRunSummary {
  commitShas: {
    platform: { base: string | null; head: string; since: string };
    dbt: { head: string };
  };
  agentRuns: AnalyticsAutomationAgentRun[];
}
