/** The Checkup (chunk 20a-2), as ally-be's `v1/chatbots/:id/checkup` serves it. */

export type CheckupExpect = "answer" | "decline" | "clarify" | "crisis_only" | "smalltalk";
export type CheckupVerdict = "pass" | "fail" | "needs_input" | "error";

export interface CheckupSource {
  kind: "page" | "document" | "owner" | "pack" | "platform" | "gap" | "";
  url?: string;
  document_id?: string;
  title?: string;
}

export interface Measure {
  passed: number;
  total: number;
}

export interface CheckupTotals {
  questions: number;
  accuracy: Measure;
  sources: Measure;
  honesty: Measure;
  safety: Measure;
  gaps: number;
  failed: number;
  hardFails: number;
  wrongDeclines: number;
  fallbacks: number;
}

export interface CheckupResult {
  caseId: string;
  question: string;
  expect: CheckupExpect;
  verdict: CheckupVerdict;
  outcome: string;
  reasons: string[];
  hardFail: boolean;
  /** A safety question from the pack: never removed or edited. */
  safety: boolean;
  source: CheckupSource;
  reply: string;
  /** Chunk 20d-2: which try (Must pass questions are asked 3 times on the home). */
  attempt?: number;
  tier?: "must_pass" | "nice_to_pass";
  origin?: "generated" | "owner" | "platform" | "suite";
  citations?: { documentId: string; title: string; url: string }[];
  ms?: number;
}

export interface CheckupRun {
  id: string;
  status: "running" | "done" | "failed";
  total: number;
  done: number;
  startedAt: string;
  finishedAt: string | null;
  /** Chunk 20d-2: the live step, and how many questions have been asked so far. */
  phase?: "writing" | "asking" | "checking" | "done";
  asked?: number;
  only?: "all" | "failed" | "one";
  trigger?: string;
}

export interface CheckupRunView {
  run: CheckupRun;
  totals: CheckupTotals | Record<string, never>;
  results: CheckupResult[];
}

export interface CheckupView {
  latest: CheckupRunView | null;
  /** Accuracy (0–100) of the last runs, oldest first. */
  trend: { at: string; accuracy: number }[];
  fallback: string;
  audience: string;
  /** The finished checkup before the latest, and the latest, by accuracy (chunk 20d-2). */
  compare?: { before: Measure | null; after: Measure | null } | null;
}

/** What should happen, as the owner says it (chunk 20d-2). */
export type CheckupOutcomeChoice = "answer" | "dont_know" | "decline" | "person";
export type CheckupCaseResult = "passed" | "partly" | "failed" | "needs_input" | "error";

/** One of the checkup's questions, as the owner's list shows it (chunk 20d-2). */
export interface CheckupCase {
  id: string;
  question: string;
  outcome: CheckupOutcomeChoice | null;
  expect: CheckupExpect;
  facts: string[];
  mustNot: string[];
  mustPass: boolean;
  language: string | null;
  active: boolean;
  safety: boolean;
  badge: "ally" | "you" | "chat";
  addedFrom: "chat" | "unanswered" | "thumbs_down" | null;
  source: CheckupSource;
  version: string;
  history: { runId: string; at: string; result: CheckupCaseResult }[];
}

export interface CheckupCaseInput {
  question?: string;
  outcome?: CheckupOutcomeChoice;
  facts?: string[];
  mustNot?: string[];
  mustPass?: boolean;
  language?: string;
  active?: boolean;
  addedFrom?: "chat" | "unanswered" | "thumbs_down";
}

export interface CheckupSuggestion {
  question: string;
  facts: string[];
  source?: CheckupSource;
}
