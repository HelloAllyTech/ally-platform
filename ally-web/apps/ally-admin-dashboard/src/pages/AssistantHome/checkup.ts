import type { CheckStatus } from "@components/v2";

import type { CheckupResult, CheckupRunView, CheckupTotals } from "../../types/checkup";

/**
 * How the checkup reads to an owner (chunk 20a-2), shared by the home's Checkup section and the
 * onboarding checkup screen. Pure: no React.
 */

/** The owner-facing state of one graded question. */
export const statusOf = (result: CheckupResult): CheckStatus => {
  if (result.verdict === "needs_input") return "gap";
  if (result.verdict === "fail" || result.verdict === "error") return "fix";
  if (result.safety || result.expect === "crisis_only" || result.outcome === "crisis") {
    return "safe";
  }
  if (result.outcome === "answered") return "answered";
  return "declined";
};

/** Where the answer came from, as a short label: the page's path, or "Safety rule". */
export const sourceLabel = (result: CheckupResult, safetyRule: string): string => {
  if (result.safety) return safetyRule;
  const url = result.source.url;
  if (url) {
    try {
      const { pathname } = new URL(url);
      return pathname === "/" ? "/" : pathname.replace(/\/$/, "");
    } catch {
      return url;
    }
  }
  return result.source.title || "";
};

export const hasTotals = (
  view: CheckupRunView | null,
): view is CheckupRunView & {
  totals: CheckupTotals;
} => Boolean(view && "accuracy" in view.totals);

export const accuracyPct = (totals: CheckupTotals): number =>
  totals.accuracy.total ? Math.round((totals.accuracy.passed / totals.accuracy.total) * 100) : 0;

export const gapsOf = (view: CheckupRunView | null): CheckupResult[] =>
  (view?.results ?? []).filter(r => r.verdict === "needs_input");

/** What blocks publishing (the server decides; this mirrors it for the screen's message). */
export const blocksPublishing = (view: CheckupRunView | null): "unsourced" | "safety" | null => {
  if (!view) return null;
  if (view.results.some(r => r.reasons.includes("uncited_answer"))) return "unsourced";
  if (view.results.some(r => r.safety && r.verdict !== "pass")) return "safety";
  return null;
};

export type CheckupFilter = "all" | "answered" | "safety" | "input";

export const filtered = (results: CheckupResult[], filter: CheckupFilter): CheckupResult[] => {
  switch (filter) {
    case "answered":
      return results.filter(r => statusOf(r) === "answered");
    case "safety":
      return results.filter(r => statusOf(r) === "safe" || r.safety);
    case "input":
      return results.filter(r => statusOf(r) === "gap" || statusOf(r) === "fix");
    default:
      return results;
  }
};
