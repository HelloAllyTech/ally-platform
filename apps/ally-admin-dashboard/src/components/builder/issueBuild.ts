/**
 * Reading an issue build — a run where Builder raised a GitHub issue and
 * opencode works it in the target repo's own Actions — out of the run row.
 *
 * Pure, so the rail, the repo chain, the pull request panel and the steering
 * hint all agree on what "where has it got to" means, and so it is testable
 * without a DOM.
 */
import type { BuilderBuildRun, BuilderMilestone, BuilderPullRequest } from "@types";

/** Ceiling the server puts on "please fix CI" comments per build. */
export const ISSUE_FIX_REQUEST_LIMIT = 2;

export const isIssueRun = (run: BuilderBuildRun | null | undefined): boolean =>
  run?.issueNumber !== null && run?.issueNumber !== undefined;

/**
 * The session's latest run that BUILDS — not a review or a design draft.
 *
 * Reviews and design drafts still run on Builder's own runner, after and
 * before a build. Deciding "is this an issue build" from the newest run of any
 * kind read a session whose builds were all issues as a runner session the
 * moment a review ran on its pull request.
 */
export const latestBuildRun = (
  runs: BuilderBuildRun[] | null | undefined,
): BuilderBuildRun | null =>
  [...(runs ?? [])]
    .reverse()
    .find(run => run.mode === "build" || run.mode === "resume" || run.mode === "fix") ?? null;

export const isRunActive = (run: BuilderBuildRun | null | undefined): boolean =>
  run?.status === "RUNNING" || run?.status === "QUEUED";

/** The one repo an issue build targets. */
export const issueRunRepo = (run: BuilderBuildRun | null | undefined): string | null =>
  run?.repos?.[0] ?? null;

/** `org/ally-be` and `ally-be` are the same repo for matching purposes. */
export const sameRepo = (a: string | null | undefined, b: string | null | undefined): boolean => {
  if (!a || !b) return false;
  const short = (value: string) => value.split("/").pop()?.toLowerCase() ?? "";
  return short(a) === short(b);
};

export type IssueCiState = "waiting" | "pending" | "failed" | "fixing" | "passed";

export interface IssueProgress {
  issueRaised: boolean;
  working: boolean;
  prNumber: number | null;
  /** Null until a pull request exists for CI to run on. */
  ci: IssueCiState | null;
  fixRequests: number;
  /**
   * 0 issue → 1 opencode working → 2 pull request → 3 CI → 4 passed. The step
   * in flight; 5 means every step is done.
   */
  currentStep: number;
}

/**
 * Where an issue build has got to, from `cost.issueTimeline`.
 *
 * The timeline is ordered and each key appears once, so the LAST CI-ish key is
 * the current CI state: a `fix:` after a `ci-fail:` means opencode has been
 * asked and has not pushed yet, a fresh `ci-pending:` after that means it has.
 */
export const issueProgress = (run: BuilderBuildRun): IssueProgress => {
  const timeline = run.cost?.issueTimeline ?? [];
  const kind = (key: string) => key.split(":")[0];

  const issueRaised = timeline.includes("issue") || isIssueRun(run);
  const working = timeline.some(key => kind(key) === "working");
  const prKey = timeline.find(key => kind(key) === "pr");
  const prNumber = prKey ? Number(prKey.split(":")[1]) || null : null;

  let ci: IssueCiState | null = null;
  for (const key of timeline) {
    const k = kind(key);
    if (k === "ci-pending") ci = "pending";
    else if (k === "ci-fail") ci = "failed";
    else if (k === "fix") ci = "fixing";
    else if (k === "ci-pass") ci = "passed";
  }
  if (ci === null && prNumber !== null) ci = "waiting";

  const fixRequests =
    run.cost?.issueFixRequests?.length ?? timeline.filter(key => kind(key) === "fix").length;

  let currentStep: number;
  if (ci === "passed" || run.status === "SUCCEEDED") currentStep = 5;
  else if (ci !== null && ci !== "waiting") currentStep = 3;
  else if (prNumber !== null) currentStep = 3;
  else if (issueRaised) currentStep = 1;
  else currentStep = 0;

  return { issueRaised, working, prNumber, ci, fixRequests, currentStep };
};

/**
 * The pull request an issue run opened. Prefers the tracked row (which carries
 * CI status); falls back to a URL derived from the issue's, since a run can
 * know its PR number a poll before the pull-request list does.
 */
export const issueRunPullRequest = (
  run: BuilderBuildRun,
  pullRequests: BuilderPullRequest[] | undefined,
): { number: number; url: string | null; row: BuilderPullRequest | null } | null => {
  const repo = issueRunRepo(run);
  const { prNumber } = issueProgress(run);
  const row =
    (pullRequests ?? []).find(
      pr => sameRepo(pr.repo, repo) && (prNumber === null || pr.prNumber === prNumber),
    ) ?? null;
  const number = prNumber ?? row?.prNumber ?? null;
  if (number === null) return null;
  const derived = run.issueUrl ? run.issueUrl.replace(/\/issues\/\d+.*$/, `/pull/${number}`) : null;
  return { number, url: row?.prUrl ?? derived, row };
};

/** Milestones that each build one repo, in build order. */
export const repoMilestones = (milestones: BuilderMilestone[] | undefined): BuilderMilestone[] =>
  (milestones ?? [])
    .filter(milestone => (milestone.repos?.length ?? 0) > 0)
    .sort((a, b) => a.position - b.position);

/**
 * The repo a COMPLETED session would build next, or null when the chain is
 * done. A run still in flight means there is nothing to continue yet.
 */
export const nextChainRepo = (
  milestones: BuilderMilestone[] | undefined,
  runs: BuilderBuildRun[] | undefined,
): string | null => {
  if ((runs ?? []).some(isRunActive)) return null;
  const next = repoMilestones(milestones).find(
    milestone => milestone.status !== "COMPLETED" && milestone.status !== "SKIPPED",
  );
  return next?.repos?.[0] ?? null;
};
