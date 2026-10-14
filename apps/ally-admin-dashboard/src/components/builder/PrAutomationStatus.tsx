import React from "react";

import { Tag } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import { BuilderPullRequest } from "@types";

import { automationBudget, formatTimeLeft } from "./issueBuild";

interface AutomationBudgetLineProps {
  pullRequest: BuilderPullRequest;
  maxRounds?: number;
  timeboxMs?: number;
  /** Settings' per-PR spend ceiling, USD; null/0/absent = no limit. */
  maxSpendUsd?: string | null;
  className?: string;
}

/** "$3.41", or null for nothing spent (zero, missing or unparsable). */
const dollars = (value: string | number | null | undefined): string | null => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? `$${amount.toFixed(2)}` : null;
};

/**
 * "Round 2 of 2 · 1h 10m left · $3.41 of $10.00" — how much of a pull
 * request's review-and-fix budget is left, while Builder is still working it.
 * Stacks, "Managing User Expectations in Asynchronous Agent Design": an agent
 * loop with a ceiling should show where it is against that ceiling, so a
 * person can tell "still going" from "about to hand this to me". Muted,
 * because it is not an action.
 *
 * Once Builder has stopped working it — merged, or handed to a person — the
 * rounds and clock no longer mean anything, but what it cost still does, so
 * that alone remains: "Spent $4.12 on review and fixes". Nothing spent, nothing
 * said: a "$0.00" is noise.
 */
export const AutomationBudgetLine: React.FC<AutomationBudgetLineProps> = ({
  pullRequest,
  maxRounds,
  timeboxMs,
  maxSpendUsd,
  className = "",
}) => {
  const strings = en.builder.build;
  const spent = dollars(pullRequest.automationCostUsd);
  const budget = automationBudget(pullRequest, maxRounds, timeboxMs);
  const lineClass = `text-xs text-typography-500 ${className}`.trim();

  if (!budget) {
    const settled = pullRequest.merged || Boolean(pullRequest.needsHumanAt);
    return settled && spent ? (
      <p className={lineClass}>{strings.automationSpentTotal(spent)}</p>
    ) : null;
  }

  const left =
    budget.msLeft === null
      ? null
      : budget.msLeft <= 0
        ? strings.timeLeftNone
        : (formatTimeLeft(budget.msLeft) ?? strings.timeLeftUnderMinute);

  const parts = [
    strings.automationRound(budget.round, budget.maxRounds),
    ...(left === null ? [] : [strings.automationTimeLeft(left)]),
    ...(spent ? [strings.automationSpend(spent, dollars(maxSpendUsd))] : []),
  ];

  return <p className={lineClass}>{parts.join(" · ")}</p>;
};

/** True when the release went out but the health check after it failed. */
export const isUnhealthyRelease = (pullRequest: BuilderPullRequest | null | undefined) =>
  pullRequest?.releaseState === "unhealthy";

/** The red tag for a release whose health check is failing. */
export const UnhealthyReleaseTag: React.FC = () => (
  <Tag type="red" size="sm">
    {en.builder.build.releaseUnhealthy}
  </Tag>
);

/** What it means: Builder has stopped itself, and someone should look. */
export const UnhealthyReleaseNote: React.FC<{ className?: string }> = ({ className = "" }) => (
  <p className={`text-xs text-support-error ${className}`.trim()}>
    {en.builder.build.releaseUnhealthyBody}
  </p>
);
