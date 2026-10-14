import React from "react";

import { Tag } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import { BuilderBuildRun, BuilderMilestone, BuilderPullRequest } from "@types";

import { issueRunPullRequest, repoMilestones, sameRepo } from "./issueBuild";

interface RepoChainProps {
  milestones: BuilderMilestone[];
  runs: BuilderBuildRun[];
  pullRequests: BuilderPullRequest[];
  /** The run whose activity the feed below is showing. */
  selectedRunId?: string | null;
  /**
   * Switch the feed to a repo's build. In a chained session this list is how
   * you move between repos; the strip of every run is folded away beneath it.
   */
  onSelectRun?: (runId: string) => void;
}

const STATUS_TAG: Record<string, "gray" | "blue" | "green" | "red" | "magenta" | "cool-gray"> = {
  PENDING: "gray",
  BUILDING: "blue",
  WAITING_FOR_INPUT: "magenta",
  COMPLETED: "green",
  FAILED: "red",
  SKIPPED: "cool-gray",
};

const CI_TAG: Record<string, "green" | "red" | "blue" | "gray"> = {
  success: "green",
  failure: "red",
  pending: "blue",
  none: "gray",
};

/**
 * A multi-repo design, built one repo after another: one step per repo, in
 * the order the server builds them, each with its issue, its pull request and
 * that pull request's CI.
 *
 * The repo building now is named in the heading as well as highlighted —
 * "which one is it on" is the first question anyone opening a chained session
 * asks, and a highlighted row in a list of five is easy to miss.
 *
 * Renders nothing for a session without repo milestones: a single-repo or
 * legacy build has no chain to show.
 */
export const RepoChain: React.FC<RepoChainProps> = ({
  milestones,
  runs,
  pullRequests,
  selectedRunId = null,
  onSelectRun,
}) => {
  const strings = en.builder.repoChain;
  const buildStrings = en.builder.build;
  const steps = repoMilestones(milestones);
  if (steps.length === 0) return null;

  const building = steps.find(step => step.status === "BUILDING");

  return (
    <section
      className="mx-3 mt-2 rounded border border-neutral-200 px-3 py-2"
      aria-label={strings.heading}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-typography-500">
          {strings.heading}
        </h2>
        {building?.repos?.[0] && (
          <span className="text-xs font-medium text-primary-700">
            {strings.building(building.repos[0])}
          </span>
        )}
      </div>
      <ol className="mt-2 flex flex-col gap-1.5">
        {steps.map((step, index) => {
          const repo = step.repos?.[0] ?? "";
          // The newest run for this milestone is the one that speaks for it.
          const run =
            [...runs].reverse().find(candidate => candidate.milestoneId === step.id) ?? null;
          const pr = run ? issueRunPullRequest(run, pullRequests) : null;
          const prRow = pr?.row ?? pullRequests.find(candidate => sameRepo(candidate.repo, repo));
          const prNumber = pr?.number ?? prRow?.prNumber ?? null;
          const prUrl = pr?.url ?? prRow?.prUrl ?? null;
          const ciStatus = prRow?.ciStatus ?? null;
          const isBuilding = step.status === "BUILDING";

          return (
            <li
              key={step.id}
              aria-current={isBuilding ? "step" : undefined}
              className={[
                "flex flex-wrap items-center gap-x-2 gap-y-1 rounded px-2 py-1 text-xs",
                isBuilding ? "bg-primary-50" : "",
              ].join(" ")}
            >
              <span className="w-4 shrink-0 tabular-nums text-typography-400">{index + 1}</span>
              <span className="min-w-[6rem] font-medium text-typography-900">{repo}</span>
              <Tag type={STATUS_TAG[step.status] ?? "gray"} size="sm">
                {strings.status[step.status] ?? step.status}
              </Tag>
              {run?.issueUrl && run.issueNumber != null && (
                <a
                  href={run.issueUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary-700 hover:underline"
                >
                  {buildStrings.issueLink(null, run.issueNumber)}
                </a>
              )}
              {prNumber !== null && prUrl && (
                <a
                  href={prUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary-700 hover:underline"
                >
                  {buildStrings.prLink(prNumber)}
                </a>
              )}
              {ciStatus && (
                <Tag type={CI_TAG[ciStatus] ?? "gray"} size="sm">
                  {buildStrings.ciStatus[ciStatus] ?? ciStatus}
                </Tag>
              )}
              {run &&
                onSelectRun &&
                (run.id === selectedRunId ? (
                  <span className="ml-auto text-typography-500">{strings.showingActivity}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelectRun(run.id)}
                    className="ml-auto text-primary-700 hover:underline"
                  >
                    {strings.showActivity(repo)}
                  </button>
                ))}
              {step.status === "FAILED" && step.error && (
                <p className="basis-full pl-6 text-support-error">{step.error}</p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
};
