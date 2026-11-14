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

export const hasTotals = (
  view: CheckupRunView | null,
): view is CheckupRunView & {
  totals: CheckupTotals;
} => Boolean(view && "accuracy" in view.totals);

export const accuracyPct = (totals: CheckupTotals): number =>
  totals.accuracy.total ? Math.round((totals.accuracy.passed / totals.accuracy.total) * 100) : 0;

export const gapsOf = (view: CheckupRunView | null): CheckupResult[] =>
  (view?.results ?? []).filter(r => r.verdict === "needs_input");
