/**
 * Analytics Automation — types mirroring ally-be's
 * `/v1/analytics/agent/automation` DTOs.
 *
 * Once a week the server runs three agents: a backend review (a description of
 * how the backend changed), a PostHog events agent (opens a pull request), and a
 * dbt agent that waits for that pull request to be merged or closed, proposes
 * dbt changes, and edits the dbt repo only after a person approves. Runs are
 * started by the scheduler only; the tab reads them and approves or rejects the
 * dbt proposal.
 */

export type AnalyticsAutomationRunStatus = "running" | "completed" | "failed";

export type AnalyticsAutomationAgentName = "backend_review" | "posthog_events" | "dbt_metrics";

/** `running`/`completed`/`failed` for the first two agents; the rest are the dbt agent's steps. */
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
  /** Markdown. For the backend review this is the result. */
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

/** What the server allows. `manualStartEnabled` is a testing aid (see the tab). */
export interface AnalyticsAutomationConfig {
  manualStartEnabled: boolean;
}
