import React from "react";

import { TooltipIcon, WarningAlt } from "@icons";

import { Button, Tooltip } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import type { CourseBlueprintEstimate, CourseCopilotBudget } from "@types";

import { formatMinutes, formatUsd } from "./courseCopilotFormat";

/**
 * Whether the estimate is more than the budget has left. A ceiling of 0 means
 * uncapped (the server's convention), which can never be over.
 */
export const isOverBudget = (
  estimateUsd: number,
  budget: Pick<CourseCopilotBudget, "ceilingUsd" | "remainingUsd">,
): boolean =>
  budget.ceilingUsd > 0 &&
  budget.remainingUsd !== null &&
  Number.isFinite(estimateUsd) &&
  estimateUsd > budget.remainingUsd;

export interface BlueprintFooterProps {
  /** Totals taken from the tree as it stands, so they follow an edit before the server answers. */
  totals: { minutes: number; items: number };
  /** `brief.shape.durationMinutes` — what the trainer asked for. */
  targetMinutes?: number | null;
  /** The server's last estimate: it owns cost and image counts, which need the whole brief to compute. */
  estimate: CourseBlueprintEstimate;
  /** True between an edit and the response that recomputes `estimate`. */
  estimateUpdating: boolean;
  budget: CourseCopilotBudget;
  problems: string[];
  /** Why Approve is off beyond problems and budget (saving, copilot busy…). Null when it is on. */
  approveDisabledReason: string | null;
  isApproving: boolean;
  /** False once the blueprint is approved or while the status cannot take an approval. */
  showApprove: boolean;
  onApprove: () => void;
  onRaiseBudget: () => void;
}

/**
 * Totals, cost against budget, blocking problems, and the one button that spends
 * money. Everything that decides whether Approve is allowed is on screen next to
 * it — a disabled button with no stated reason makes the trainer hunt for one.
 *
 * The cost is labelled and explained as an estimate that can differ from the real
 * spend: Stacks, "Making Agent Trustworthiness Visible Through Transparency" — surface
 * uncertainty rather than hide it, and keep override (raise the budget, trim the
 * course) one click from the number that blocks you.
 */
export const BlueprintFooter: React.FC<BlueprintFooterProps> = ({
  totals,
  targetMinutes,
  estimate,
  estimateUpdating,
  budget,
  problems,
  approveDisabledReason,
  isApproving,
  showApprove,
  onApprove,
  onRaiseBudget,
}) => {
  const strings = en.courseCopilotPane.blueprint.footer;
  const overBudget = showApprove && isOverBudget(estimate.usd, budget);
  const uncapped = budget.ceilingUsd <= 0 || budget.remainingUsd === null;
  const disabled =
    Boolean(approveDisabledReason) || problems.length > 0 || overBudget || isApproving;

  const helper =
    problems.length > 0
      ? strings.fixProblems
      : overBudget
        ? strings.overBudgetShort
        : approveDisabledReason;

  return (
    <div className="space-y-3 border-t border-neutral-200 bg-white px-4 py-3">
      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <div className="flex items-baseline gap-1.5">
          <dt className="text-xs text-typography-700">{strings.duration}</dt>
          <dd className="font-medium text-typography-900">
            {formatMinutes(totals.minutes)}
            {targetMinutes ? (
              <span className="ml-1 text-xs font-normal text-typography-700">
                {strings.target(formatMinutes(targetMinutes))}
              </span>
            ) : null}
          </dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt className="text-xs text-typography-700">{strings.items}</dt>
          <dd className="font-medium text-typography-900">{totals.items}</dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt className="text-xs text-typography-700">{strings.newRoleplays}</dt>
          <dd className="font-medium text-typography-900">{estimate.newRoleplays}</dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt className="text-xs text-typography-700">{strings.images}</dt>
          <dd className="font-medium text-typography-900">{estimate.images}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1.5">
          <span className="text-xs text-typography-700">{strings.estimatedCost}</span>
          <span
            className={`font-medium ${overBudget ? "text-destructive-600" : "text-typography-900"}`}
          >
            {formatUsd(estimate.usd)}
          </span>
          {estimateUpdating && (
            <span className="text-xs text-typography-700">{strings.estimateUpdating}</span>
          )}
          <Tooltip label={strings.estimateHint} align="top">
            <button type="button" className="inline-flex cursor-pointer items-center">
              <TooltipIcon />
            </button>
          </Tooltip>
        </span>
        {showApprove && (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-xs text-typography-700">{strings.remainingBudget}</span>
            <span className="font-medium text-typography-900">
              {uncapped ? strings.noCap : formatUsd(budget.remainingUsd)}
            </span>
          </span>
        )}
      </div>

      {overBudget && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive-200 bg-destructive-50 px-3 py-2 text-sm text-destructive-700">
          <span className="min-w-0 flex-1">
            {strings.overBudget(formatUsd(estimate.usd), formatUsd(budget.remainingUsd))}
          </span>
          <Button kind="tertiary" size="sm" onClick={onRaiseBudget}>
            {strings.raiseBudget}
          </Button>
        </div>
      )}

      {problems.length > 0 && (
        <div className="rounded-md border border-destructive-200 bg-destructive-50 px-3 py-2">
          <p className="flex items-center gap-1.5 text-sm font-medium text-destructive-700">
            <WarningAlt className="h-4 w-4 shrink-0" />
            {strings.problemsHeading}
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-destructive-700">
            {problems.map(problem => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      {showApprove && (
        <div className="flex flex-wrap items-center gap-3">
          <Button kind="primary" disabled={disabled} onClick={onApprove}>
            {strings.approve}
          </Button>
          <Tooltip label={strings.approveHint} align="top">
            <button type="button" className="inline-flex cursor-pointer items-center">
              <TooltipIcon />
            </button>
          </Tooltip>
          {helper && disabled && <span className="text-xs text-typography-700">{helper}</span>}
        </div>
      )}
    </div>
  );
};
