import React from "react";

import { Button, Tag } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import { BuilderBuildRun, BuilderMilestone, BuilderPrFeedback, BuilderPullRequest } from "@types";

import { ChainRow, chainRows } from "./issueBuild";
import { IssueRail } from "./IssueRail";
import { NeedsHumanBlock, openFindingsFor } from "./NeedsHumanBlock";
import {
  AutomationBudgetLine,
  UnhealthyReleaseNote,
  UnhealthyReleaseTag,
  isUnhealthyRelease,
} from "./PrAutomationStatus";

interface RepoChainProps {
  milestones: BuilderMilestone[];
  runs: BuilderBuildRun[];
  pullRequests: BuilderPullRequest[];
  /** The run whose activity the feed below is showing. */
  selectedRunId?: string | null;
  /**
   * Switch the feed to a repo's build. In a chained session this table is how
   * you move between repos; the strip of every run is folded away beneath it.
   */
  onSelectRun?: (runId: string) => void;
  /** Merge a row's pull request. Without it the rows show no merge control. */
  onMerge?: (pullRequestId: string) => void;
  /** The pull request a merge is in flight for. */
  mergingId?: string | null;
  isMerging?: boolean;
  /** The session's PR findings — the open ones show under a row that needs you. */
  feedback?: BuilderPrFeedback[];
  /** Give a pull request back to Builder. Without it no Resume control shows. */
  onResume?: (pullRequestId: string) => void;
  /** The pull request a resume is in flight for. */
  resumingId?: string | null;
  /** The per-PR review-and-fix budget, for the "Round n of m · time left" line. */
  maxFixRuns?: number;
  timeboxMs?: number;
}

const STATUS_TAG: Record<string, "gray" | "blue" | "green" | "red" | "magenta" | "cool-gray"> = {
  PENDING: "gray",
  BUILDING: "blue",
  WAITING_FOR_INPUT: "magenta",
  COMPLETED: "green",
  FAILED: "red",
  SKIPPED: "cool-gray",
};

const LINK = "text-primary-700 hover:underline";

/** What the row wants next, in a few words — or nothing when its tags say it. */
const nextStep = (row: ChainRow, previousRepo: string | null): string | null => {
  const strings = en.builder.repoChain;
  // The server's reason sits under the row and says it better.
  if (row.needsHuman) return null;
  switch (row.mergeRole) {
    case "primary":
      return strings.nextReview;
    case "after":
      return row.mergeAfter ? strings.nextMergeAfter(row.mergeAfter) : null;
    case "notReady":
      // Never a second copy of what the row already shows: while it builds,
      // the progress line under it says where opencode is; a CI verdict is
      // in the CI cell. Only what to DO about it goes here.
      if (row.building || row.ciStatus === "pending") return null;
      return row.ciStatus === "failure" ? strings.nextCiFailed : strings.nextCiRunning;
    case "merged":
    case "closed":
      return null;
    default:
      // No pull request yet. A building row has its progress line under it and
      // a failed one its error, so only a waiting row needs words here.
      if (row.milestone.status !== "PENDING") return null;
      return previousRepo ? strings.nextStartsAfter(previousRepo) : strings.nextWaiting;
  }
};

/**
 * A multi-repo issue build as one table: a row per repo, in the order the
 * server builds them, holding everything there is to say about that repo —
 * status, pull request, CI, what it wants next, and the merge itself.
 *
 * Each fact lives here once. The page used to repeat a pull request's number
 * six times and "CI passed" eight (a repo list, a rail with its own links, the
 * feed, a separate pull-request panel, the steering hint) — Stacks'
 * "Segmentation and Redundancy in Multimedia Design": the same information in
 * several places adds load without adding meaning. So the rail is a line
 * inside the row that is building, and the pull-request panel is gone for a
 * chain.
 *
 * One action is prominent ("Desert Oasis: Isolating the Primary
 * Call-to-Action"): the first unmerged pull request, once it is ready. Later
 * ones are quiet "Merge after <repo>" controls, because each repo was built on
 * the assumption the ones before it land first ("Visual Hierarchy: Controlling
 * Perception Order").
 *
 * Renders nothing for a session without repo milestones.
 */
export const RepoChain: React.FC<RepoChainProps> = ({
  milestones,
  runs,
  pullRequests,
  selectedRunId = null,
  onSelectRun,
  onMerge,
  mergingId = null,
  isMerging = false,
  feedback,
  onResume,
  resumingId = null,
  maxFixRuns,
  timeboxMs,
}) => {
  const strings = en.builder.repoChain;
  const buildStrings = en.builder.build;
  const rows = chainRows(milestones, runs, pullRequests);
  if (rows.length === 0) return null;

  return (
    <section className="mx-3 mt-2 rounded border border-neutral-200" aria-label={strings.heading}>
      <ol className="flex flex-col divide-y divide-neutral-100">
        {rows.map((row, index) => {
          const { milestone, repo, run, pr } = row;
          const prRow = pr?.row ?? null;
          const step = nextStep(row, index > 0 ? rows[index - 1].repo : null);
          const actionsLogUrl = run?.cost?.issueWorkflowRunUrl ?? null;

          return (
            <li
              key={milestone.id}
              aria-current={row.building ? "step" : undefined}
              className={["px-3 py-2 text-xs", row.building ? "bg-primary-50/60" : ""].join(" ")}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="w-4 shrink-0 tabular-nums text-typography-400">{index + 1}</span>
                <span className="min-w-[6rem] font-medium text-typography-900">{repo}</span>
                {/* Magenta, like "Waiting on you": Carbon has no yellow tag, and
                    this is the same news — the next move is a person's. */}
                {row.needsHuman ? (
                  <Tag type="magenta" size="sm">
                    {buildStrings.needsYou.tag}
                  </Tag>
                ) : (
                  <Tag type={STATUS_TAG[milestone.status] ?? "gray"} size="sm">
                    {strings.status[milestone.status] ?? milestone.status}
                  </Tag>
                )}

                {/* The pull request number is the way to GitHub — where the
                    review and its approval happen. The issue is only worth a
                    link until there is a pull request to look at instead. */}
                {pr?.url ? (
                  <a href={pr.url} target="_blank" rel="noreferrer" className={LINK}>
                    {strings.prNumber(pr.number)}
                  </a>
                ) : run?.issueUrl && run.issueNumber != null ? (
                  <a href={run.issueUrl} target="_blank" rel="noreferrer" className={LINK}>
                    {buildStrings.issueLink(null, run.issueNumber)}
                  </a>
                ) : null}

                {row.ciStatus === "success" ? (
                  <span className="text-support-success" aria-label={strings.ciPassedLabel}>
                    {strings.ciPassed}
                  </span>
                ) : row.ciStatus === "failure" ? (
                  <span className="text-support-error" aria-label={strings.ciFailedLabel}>
                    {strings.ciFailed}
                  </span>
                ) : row.ciStatus === "pending" ? (
                  <span className="text-typography-500">{strings.ciRunning}</span>
                ) : null}

                {step && <span className="text-typography-600">{step}</span>}

                <span className="ml-auto flex items-center gap-3">
                  {run &&
                    onSelectRun &&
                    (run.id === selectedRunId ? (
                      <span className="text-typography-500">{strings.showingActivity}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSelectRun(run.id)}
                        aria-label={strings.showActivity(repo)}
                        className={LINK}
                      >
                        {strings.activityLink}
                      </button>
                    ))}

                  {row.mergeRole === "merged" &&
                    (isUnhealthyRelease(prRow) ? (
                      <UnhealthyReleaseTag />
                    ) : (
                      <Tag type="green" size="sm">
                        {buildStrings.prMerged}
                      </Tag>
                    ))}
                  {row.mergeRole === "closed" && (
                    <Tag type="gray" size="sm">
                      {buildStrings.prClosed}
                    </Tag>
                  )}
                  {/* When the first unmerged pull request needs a person, the
                      page's one prominent action is reading it, not merging. */}
                  {row.reviewFirst && pr?.url && (
                    <Button size="sm" kind="primary" href={pr.url} target="_blank" rel="noreferrer">
                      {strings.reviewOnGithub}
                    </Button>
                  )}
                  {onMerge &&
                    prRow &&
                    (row.mergeRole === "primary" ||
                      row.mergeRole === "after" ||
                      row.mergeRole === "notReady") && (
                      <Button
                        size="sm"
                        kind={row.mergeRole === "primary" && !row.reviewFirst ? "primary" : "ghost"}
                        // Nothing approves on anyone's behalf: GitHub's branch
                        // protection wants a review first, given on the PR.
                        title={strings.mergeApprovalHint}
                        disabled={isMerging || !row.mergeable}
                        onClick={() => onMerge(prRow.id)}
                      >
                        {mergingId === prRow.id
                          ? buildStrings.prMerging
                          : row.mergeFirst
                            ? strings.mergeFirst
                            : buildStrings.prMerge}
                      </Button>
                    )}
                </span>
              </div>

              {/* "Managing User Expectations in Asynchronous Agent Design":
                  while a repo builds, its progress sits right under it — and
                  only then; a finished chain carries no rail at all. */}
              {row.building && run && (
                <div className="mt-1 flex flex-wrap items-center gap-3 pl-7">
                  <IssueRail run={run} compact />
                  {actionsLogUrl && (
                    <a href={actionsLogUrl} target="_blank" rel="noreferrer" className={LINK}>
                      {strings.actionsLog}
                    </a>
                  )}
                </div>
              )}

              {prRow && (
                <AutomationBudgetLine
                  className="mt-1 pl-7"
                  pullRequest={prRow}
                  maxRounds={maxFixRuns}
                  timeboxMs={timeboxMs}
                />
              )}
              {isUnhealthyRelease(prRow) && <UnhealthyReleaseNote className="mt-1 pl-7" />}

              {row.needsHuman && prRow && onResume && (
                <NeedsHumanBlock
                  className="mt-1 pl-7"
                  pullRequest={prRow}
                  findings={openFindingsFor(prRow.id, feedback)}
                  onResume={onResume}
                  resuming={resumingId === prRow.id}
                />
              )}

              {milestone.status === "FAILED" && milestone.error && (
                <p className="mt-1 pl-7 text-support-error">{milestone.error}</p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
};
