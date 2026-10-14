/**
 * Reading an issue build — a run where Builder raised a GitHub issue and
 * opencode works it in the target repo's own Actions — out of the run row.
 *
 * Pure, so the rail, the repo chain, the pull request panel and the steering
 * hint all agree on what "where has it got to" means, and so it is testable
 * without a DOM.
 */
import type {
  BuilderBuildEvent,
  BuilderBuildRun,
  BuilderMilestone,
  BuilderPullRequest,
} from "@types";

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

/**
 * Whether the session page should use the consolidated repo-table layout:
 * the latest BUILD is an issue build and the design was split into repos.
 * Runner sessions, and issue builds without repo milestones, keep the
 * original layout.
 */
export const isChainedIssueSession = (
  runs: BuilderBuildRun[] | null | undefined,
  milestones: BuilderMilestone[] | undefined,
): boolean => isIssueRun(latestBuildRun(runs)) && repoMilestones(milestones).length > 0;

/** What a row of the repo table offers for its pull request. */
export type ChainMergeRole =
  /** The one prominent action on the page: the first unmerged, ready PR. */
  | "primary"
  /** A later PR — mergeable on its own terms, but after the one before it. */
  | "after"
  /** First in line but not ready yet (CI not green, or opencode still on it). */
  | "notReady"
  | "merged"
  | "closed"
  | "none";

export interface ChainRow {
  milestone: BuilderMilestone;
  repo: string;
  /** The newest run for this milestone — the one that speaks for the repo. */
  run: BuilderBuildRun | null;
  pr: { number: number; url: string | null; row: BuilderPullRequest | null } | null;
  ciStatus: string | null;
  /** True while this repo's issue run is still going. */
  building: boolean;
  mergeRole: ChainMergeRole;
  /** Merge is possible: CI green and opencode no longer working on it. */
  mergeable: boolean;
  /** "Merge first" — later repos are waiting on this one. */
  mergeFirst: boolean;
  /** The repo whose pull request should be merged before this one. */
  mergeAfter: string | null;
  /** Builder's review-and-fix loop handed this pull request to a person. */
  needsHuman: boolean;
  /**
   * The first unmerged pull request needs a person: the page's one prominent
   * action is then reading it on GitHub, not merging it.
   */
  reviewFirst: boolean;
}

/**
 * One row per repo, in build order, with the merge order worked out.
 *
 * Merge order follows build order: each repo was built against the design on
 * the assumption the ones before it land first. So the primary action is only
 * ever the FIRST unmerged pull request, and only once it is ready — a green PR
 * further down is offered as a secondary "Merge after <repo>", never promoted
 * past a red one ahead of it.
 */
export const chainRows = (
  milestones: BuilderMilestone[] | undefined,
  runs: BuilderBuildRun[] | undefined,
  pullRequests: BuilderPullRequest[] | undefined,
): ChainRow[] => {
  const base = repoMilestones(milestones).map(milestone => {
    const repo = milestone.repos?.[0] ?? "";
    const run =
      [...(runs ?? [])].reverse().find(candidate => candidate.milestoneId === milestone.id) ?? null;
    const fromRun = run ? issueRunPullRequest(run, pullRequests) : null;
    const row =
      fromRun?.row ??
      (pullRequests ?? []).find(candidate => sameRepo(candidate.repo, repo)) ??
      null;
    const pr = fromRun ?? (row ? { number: row.prNumber, url: row.prUrl, row } : null);
    const building = isRunActive(run);
    return {
      milestone,
      repo,
      run,
      pr,
      ciStatus: row?.ciStatus ?? null,
      building,
      mergeable: row?.ciStatus === "success" && !building,
      open: Boolean(row) && !row?.merged && row?.state !== "closed",
    };
  });

  const openIndexes = base.flatMap((row, index) => (row.open ? [index] : []));
  const firstOpen = openIndexes[0] ?? -1;

  return base.map(({ open, ...row }, index) => {
    const prRow = row.pr?.row ?? null;
    let mergeRole: ChainMergeRole = "none";
    if (prRow?.merged) mergeRole = "merged";
    else if (prRow?.state === "closed") mergeRole = "closed";
    else if (open && index === firstOpen) mergeRole = row.mergeable ? "primary" : "notReady";
    else if (open) mergeRole = "after";

    const previousOpen = [...openIndexes].reverse().find(candidate => candidate < index);
    const needsHuman = Boolean(open && prRow?.needsHumanAt);
    const reviewFirst = needsHuman && index === firstOpen;
    return {
      ...row,
      mergeRole,
      needsHuman,
      reviewFirst,
      // "Merge first" is the page's one prominent action — unless this pull
      // request needs a person, in which case reading it is.
      mergeFirst: mergeRole === "primary" && openIndexes.length > 1 && !reviewFirst,
      mergeAfter:
        mergeRole === "after" && previousOpen !== undefined ? base[previousOpen].repo : null,
    };
  });
};

/** The header's one-line account of a chain. */
export type ChainSummary =
  | { kind: "needsYou"; repo: string }
  | { kind: "building"; repo: string; position: number; total: number }
  | { kind: "stopped"; repo: string }
  | { kind: "built"; built: number; total: number };

export const chainSummary = (
  milestones: BuilderMilestone[] | undefined,
  sessionFailed: boolean,
  /** The first repo, in chain order, whose pull request needs a person. */
  needsYouRepo: string | null = null,
): ChainSummary | null => {
  const steps = repoMilestones(milestones);
  if (!steps.length) return null;
  // Ahead of everything else: it is the one state that waits on the reader.
  if (needsYouRepo) return { kind: "needsYou", repo: needsYouRepo };
  const buildingIndex = steps.findIndex(step => step.status === "BUILDING");
  if (buildingIndex >= 0) {
    return {
      kind: "building",
      repo: steps[buildingIndex].repos?.[0] ?? "",
      position: buildingIndex + 1,
      total: steps.length,
    };
  }
  const failed = steps.find(step => step.status === "FAILED");
  if (failed || sessionFailed) {
    const at =
      failed ?? steps.find(step => step.status !== "COMPLETED" && step.status !== "SKIPPED");
    if (at?.repos?.[0]) return { kind: "stopped", repo: at.repos[0] };
  }
  return {
    kind: "built",
    built: steps.filter(step => step.status === "COMPLETED").length,
    total: steps.length,
  };
};

/**
 * Server status lines that only restate what the repo table already shows.
 *
 * Matched on the exact phrasing ally-be writes in
 * `BuilderPullRequestService` (`recordIssueMilestone` text for `pr:`,
 * `ci-pending:` and `ci-pass:`), so a rewording there makes these lines
 * reappear rather than hiding anything else. Failures, fix requests and every
 * other line are kept.
 */
const RESTATED_STATUS_PREFIXES = ["opencode opened ", "CI is running on ", "CI passed on "];

/**
 * An issue run's feed without what the table already says: the PR-opened and
 * CI-running / CI-passed lines, and the CI cards that carry no failed checks.
 * A CI card that names failing checks is the one place those names appear, so
 * it stays.
 */
export const withoutRestatedStatus = (events: BuilderBuildEvent[]): BuilderBuildEvent[] =>
  events.filter(event => {
    if (event.type === "text") {
      const text = String(event.payload?.text ?? "");
      return !RESTATED_STATUS_PREFIXES.some(prefix => text.startsWith(prefix));
    }
    if (event.type === "ci_result") {
      const failed = event.payload?.failed;
      return Array.isArray(failed) && failed.length > 0;
    }
    return true;
  });
