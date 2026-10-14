import React from "react";

import { en } from "@constants";
import { BuilderBuildRun } from "@types";

import { ISSUE_FIX_REQUEST_LIMIT, isRunActive, issueProgress } from "./issueBuild";
import { prefersReducedMotion } from "../../pages/Builder/builderMotion";

interface IssueRailProps {
  run: BuilderBuildRun;
}

/**
 * Where an issue build has got to: issue raised → opencode working → pull
 * request opened → CI → CI passed.
 *
 * The {@link PhaseRail} counterpart for a build Builder does not run itself.
 * It reads the run's own `cost.issueTimeline` rather than the session's
 * `currentStage`, so it does not go grey while the session sits in SETUP
 * between two repos of a chain — each run carries its own progress.
 */
export const IssueRail: React.FC<IssueRailProps> = ({ run }) => {
  const strings = en.builder.build.issueRail;
  const progress = issueProgress(run);
  const active = isRunActive(run);
  const failed = ["FAILED", "TIMED_OUT", "CANCELLED"].includes(run.status);
  const reduced = prefersReducedMotion();

  const ciLabel =
    progress.ci === "pending"
      ? strings.ciPending
      : progress.ci === "failed"
        ? strings.ciFailed
        : progress.ci === "fixing"
          ? strings.ciFixing
          : progress.ci === "waiting"
            ? strings.ciWaiting
            : strings.ciNeutral;
  const ciDetail =
    progress.fixRequests > 0
      ? ` · ${strings.fixRequests(progress.fixRequests, ISSUE_FIX_REQUEST_LIMIT)}`
      : "";

  const steps = [
    strings.issue,
    strings.working,
    progress.prNumber !== null ? `${strings.pr} #${progress.prNumber}` : strings.pr,
    `${ciLabel}${ciDetail}`,
    strings.passed,
  ];

  return (
    <ol className="flex items-center gap-1 overflow-x-auto px-4 py-2" aria-label={strings.label}>
      {steps.map((label, index) => {
        const isDone = progress.currentStep > index;
        const isCurrent = progress.currentStep === index;
        // A red CI result is not the build failing — opencode is asked to fix
        // it — so only a run that actually ended marks the step red.
        const stoppedHere = isCurrent && failed;
        const warn = isCurrent && !stoppedHere && progress.ci === "failed" && index === 3;

        return (
          <li key={index} className="flex shrink-0 items-center gap-1">
            <span
              className={[
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs",
                isDone
                  ? "bg-support-success/10 text-support-success"
                  : isCurrent
                    ? "bg-primary-50 font-medium text-primary-700"
                    : "text-typography-400",
              ].join(" ")}
              aria-current={isCurrent ? "step" : undefined}
            >
              <span
                className={[
                  "inline-block h-1.5 w-1.5 rounded-full",
                  isDone
                    ? "bg-support-success"
                    : stoppedHere
                      ? "bg-support-error"
                      : warn
                        ? "bg-support-warning"
                        : isCurrent
                          ? "bg-primary-600"
                          : "bg-neutral-300",
                  isCurrent && active && !reduced ? "animate-pulse" : "",
                ].join(" ")}
              />
              {label}
            </span>
            {index < steps.length - 1 && (
              <span
                className={["h-px w-4", isDone ? "bg-support-success/40" : "bg-neutral-200"].join(
                  " ",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
};
