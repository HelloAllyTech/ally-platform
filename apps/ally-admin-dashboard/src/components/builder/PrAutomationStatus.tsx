import React from "react";

import { Tag } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import { BuilderPullRequest } from "@types";

import { automationBudget, formatTimeLeft } from "./issueBuild";

interface AutomationBudgetLineProps {
  pullRequest: BuilderPullRequest;
  maxRounds?: number;
  timeboxMs?: number;
  className?: string;
}

/**
 * "Round 2 of 3 · 1h 10m left" — how much of a pull request's review-and-fix
 * budget is left, while Builder is still working it. Stacks, "Managing User
 * Expectations in Asynchronous Agent Design": an agent loop with a ceiling
 * should show where it is against that ceiling, so a person can tell "still
 * going" from "about to hand this to me". Muted, because it is not an action.
 */
export const AutomationBudgetLine: React.FC<AutomationBudgetLineProps> = ({
  pullRequest,
  maxRounds,
  timeboxMs,
  className = "",
}) => {
  const strings = en.builder.build;
  const budget = automationBudget(pullRequest, maxRounds, timeboxMs);
  if (!budget) return null;

  const left =
    budget.msLeft === null
      ? null
      : budget.msLeft <= 0
        ? strings.timeLeftNone
        : (formatTimeLeft(budget.msLeft) ?? strings.timeLeftUnderMinute);

  return (
    <p className={`text-xs text-typography-500 ${className}`.trim()}>
      {left === null
        ? strings.automationBudgetRoundOnly(budget.round, budget.maxRounds)
        : strings.automationBudget(budget.round, budget.maxRounds, left)}
    </p>
  );
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
