import { HOME } from "./copy";

import type {
  CheckupCase,
  CheckupCaseResult,
  CheckupResult,
  CheckupRunView,
} from "../../types/checkup";

/**
 * The owner's Checkup (chunk 20d-2), pure: each question beside its latest results, what the
 * filters keep, and why a question didn't pass in plain words. The grading itself is ally-ai's.
 */

export type CaseFilter = "all" | "failed" | "partly" | "passed" | "mustPass" | "byYou" | "byAlly";

export interface CaseRow {
  item: CheckupCase;
  /** The latest checkup's tries of this question (3 for Must pass ones on the home). */
  tries: CheckupResult[];
  result: CheckupCaseResult | null;
}

/** Passed, Partly (some tries), Failed, or Needs your input, from one checkup's tries. */
export const resultOf = (verdicts: string[]): CheckupCaseResult => {
  const graded = verdicts.filter(v => v !== "error");
  if (!graded.length) return "error";
  if (graded.every(v => v === "pass")) return "passed";
  if (graded.every(v => v === "needs_input")) return "needs_input";
  if (graded.some(v => v === "pass")) return "partly";
  return "failed";
};

export const rowsOf = (cases: CheckupCase[], run: CheckupRunView | null): CaseRow[] => {
  const byCase = new Map<string, CheckupResult[]>();
  for (const result of run?.results ?? []) {
    byCase.set(result.caseId, [...(byCase.get(result.caseId) ?? []), result]);
  }
  return cases.map(item => {
    const tries = byCase.get(item.id) ?? [];
    return { item, tries, result: tries.length ? resultOf(tries.map(t => t.verdict)) : null };
  });
};

export const keeps = (filter: CaseFilter) => (row: CaseRow) => {
  switch (filter) {
    case "failed":
      return row.result === "failed" || row.result === "error";
    case "partly":
      return row.result === "partly";
    case "passed":
      return row.result === "passed";
    case "mustPass":
      return row.item.mustPass;
    case "byYou":
      return row.item.badge !== "ally";
    case "byAlly":
      return row.item.badge === "ally";
    default:
      return true;
  }
};

/** Failed first, then Partly, then the rest: what needs a look comes to the top. */
const ORDER: Record<string, number> = { failed: 0, error: 0, partly: 1, needs_input: 2 };
export const byConcern = (a: CaseRow, b: CaseRow) =>
  (ORDER[a.result ?? ""] ?? 3) - (ORDER[b.result ?? ""] ?? 3);

const REASONS = HOME.checkupControls.reasons;

/** The one line under a result: the first reason the grader gave, in plain words. */
export const reasonOf = (tries: CheckupResult[]): string | null => {
  const failing = tries.find(t => t.verdict === "fail" || t.verdict === "error");
  if (!failing) return null;
  for (const code of failing.reasons) {
    if (code in REASONS) return REASONS[code as keyof typeof REASONS];
    if (code.startsWith("v1_fallback")) return REASONS.v1_fallback;
    if (code.startsWith("expected_answer")) return REASONS.expected_answer;
    if (code.startsWith("expected_decline")) return REASONS.expected_decline;
    if (code.startsWith("expected_crisis")) return REASONS.expected_crisis;
  }
  return REASONS.other;
};

/** A question's answers (the latest try) and where it looked, without repeats. */
export const passagesOf = (tries: CheckupResult[]) => {
  const seen = new Set<string>();
  return tries
    .flatMap(t => t.citations ?? [])
    .filter(c => {
      const key = c.url || c.title;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

/** Which step a run is on, for the live steps (1 writing, 2 asking, 3 checking, 4 result). */
export const stepOf = (run: CheckupRunView["run"]): 1 | 2 | 3 | 4 => {
  if (run.status !== "running") return 4;
  if (run.phase === "writing") return 1;
  if (run.phase === "checking") return 3;
  return 2;
};
