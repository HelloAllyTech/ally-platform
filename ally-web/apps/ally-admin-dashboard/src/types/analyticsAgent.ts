/**
 * Analytics Agent — types mirroring ally-be's `/v1/analytics/agent` DTOs.
 *
 * The agent itself is stateless: the browser hands it the turns it should
 * consider on every question. Each answered turn is also saved server-side, per
 * user, so the thread can be reopened from the sidebar after a reload — the
 * saved copy is for display only and is never what the agent reads.
 */

/** What happened to a question. Each value is a different screen, not a flag. */
export type AnalyticsAgentOutcome =
  /** Answered: `answer`, `rows` and possibly `chart` are populated. */
  | "answer"
  /** Ambiguous — `message` holds the agent's clarifying question. */
  | "clarify"
  /** Not answerable from the readable tables — `message` says what is missing. */
  | "refused"
  /** The generated SQL broke a safety rule — `message` says which. */
  | "rejected"
  /** The query was valid but failed to run (e.g. it timed out). */
  | "failed";

export type AnalyticsAgentChartType = "none" | "line" | "bar" | "stacked_bar" | "scatter";

/** How to plot the result, in terms of the result's own column names. */
export interface AnalyticsAgentChart {
  type: AnalyticsAgentChartType;
  x: string;
  y: string;
  /** Column splitting `y` into series; empty for a single series. */
  group: string;
  xLabel: string;
  yLabel: string;
  title: string;
}

/** Which models and prompt version produced the answer. Rendered, not hidden:
 *  an answer that gets screenshotted should say what wrote it. */
export interface AnalyticsAgentProvenance {
  plannerModel: string;
  answerModel: string;
  promptVersion: string;
}

export interface AnalyticsAgentTurnInput {
  question: string;
  sql?: string;
  answer?: string;
}

export interface AskAnalyticsAgentRequest {
  question: string;
  /** Prior turns, oldest first. The server keeps only the most recent few. */
  history?: AnalyticsAgentTurnInput[];
  /** The saved conversation this question continues. Omit to start a new one. */
  conversationId?: string;
}

/** A reader's optional rating of one answer. No rating is `null`, not a third value. */
export type AnalyticsAgentFeedback = "up" | "down";

export interface SetAnalyticsAgentFeedbackRequest {
  /** The saved turn being rated (`messageId` on an ask response, `id` on a saved turn). */
  messageId: string;
  /** `null` takes a rating back. */
  feedback: AnalyticsAgentFeedback | null;
}

export interface SetAnalyticsAgentFeedbackResponse {
  messageId: string;
  feedback: AnalyticsAgentFeedback | null;
}

export interface AskAnalyticsAgentResponse {
  outcome: AnalyticsAgentOutcome;
  question: string;
  message: string;
  answer: string;
  /** The SQL that ran — or, for `rejected`, the SQL that was refused. */
  sql: string;
  rationale: string;
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  /** True when the result hit the server's row cap, so a total stated in the
   *  answer is a lower bound. The table has to say so. */
  truncated: boolean;
  chart: AnalyticsAgentChart | null;
  caveats: string[];
  followUps: string[];
  durationMs: number;
  provenance: AnalyticsAgentProvenance;
  /** The saved conversation this turn belongs to. Absent only if saving failed —
   *  the answer is still valid, it just will not appear in the sidebar. */
  conversationId?: string;
  /** The saved turn, which is what feedback is recorded against. Absent when
   *  saving failed — there is then nothing to rate. */
  messageId?: string;
}

/** A saved conversation as listed in the sidebar. `title` is its first question. */
export interface AnalyticsAgentConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/** One saved turn: the question and the reply exactly as it was shown. */
export interface AnalyticsAgentConversationTurn {
  id: string;
  question: string;
  outcome: AnalyticsAgentOutcome;
  response: AskAnalyticsAgentResponse;
  /** The reader's thumbs up / down on this answer; `null` when they gave none. */
  feedback: AnalyticsAgentFeedback | null;
  createdAt: string;
}

export interface AnalyticsAgentConversationDetail extends AnalyticsAgentConversationSummary {
  /** Oldest first. */
  messages: AnalyticsAgentConversationTurn[];
}

export interface AnalyticsAgentCatalogTable {
  name: string;
  purpose: string;
  columns: string[];
}

export interface AnalyticsAgentCatalogResponse {
  tables: AnalyticsAgentCatalogTable[];
  /** Column names that are never readable, so the panel can state the policy
   *  instead of leaving a reader to discover it by being refused. */
  deniedColumns: string[];
  rowLimit: number;
}

/**
 * One entry in the on-screen thread.
 *
 * The reader's question and the agent's reply are separate entries rather than
 * one record with two halves: the question must render the moment it is asked,
 * while its reply is still pending, and a pending reply has no response object
 * to hang off.
 */
export type AnalyticsAgentMessage =
  | { id: string; role: "user"; question: string }
  | { id: string; role: "agent"; status: "pending"; question: string }
  | { id: string; role: "agent"; status: "error"; question: string; message: string }
  | {
      id: string;
      role: "agent";
      status: "done";
      response: AskAnalyticsAgentResponse;
      /** The saved turn, or null if it was not saved — then it cannot be rated. */
      messageId: string | null;
      /** The rating the turn had when it was loaded; the rating buttons own it from there. */
      feedback: AnalyticsAgentFeedback | null;
    };
