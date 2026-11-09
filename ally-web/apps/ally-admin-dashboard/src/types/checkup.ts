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
}

export interface CheckupRun {
  id: string;
  status: "running" | "done" | "failed";
  total: number;
  done: number;
  startedAt: string;
  finishedAt: string | null;
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
}
