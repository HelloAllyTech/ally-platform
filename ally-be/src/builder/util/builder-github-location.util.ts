import { repoFromGithubUrl } from 'src/github/constants/github-repos.constants';

/**
 * Where a pull request, issue or workflow run Builder stored actually lives.
 *
 * Builder's rows name a SERVICE (`repo: 'ally-be'`): the row's identity, and
 * what the drawer shows. Since the 2026-10-23 cutover `GithubActionsService`
 * routes a service name to the monorepo, and PR, issue and run numbers
 * restarted there — so a service name plus a number stored before the move
 * names a DIFFERENT monorepo pull request, one Builder would then merge,
 * approve or comment on, with nothing to say it was the wrong one.
 *
 * Every GitHub call about something stored goes through these: the "owner/name"
 * in the stored URL, which `GithubActionsService` passes through untouched. A
 * row with no URL falls back to its service, i.e. the monorepo — where anything
 * Builder creates from now on lives.
 */

/** The repo a stored pull request lives in. */
export const prRepoOf = (row: {
  prUrl?: string | null;
  repo: string;
}): string => repoFromGithubUrl(row.prUrl) ?? row.repo;

/** The repo a build run's issue lives in, or null for a run with no issue. */
export const issueRepoOf = (run: {
  issueUrl?: string | null;
  repos?: string[] | null;
}): string | null => repoFromGithubUrl(run.issueUrl) ?? run.repos?.[0] ?? null;

/** The repo a stored workflow run lives in, falling back to where Builder dispatches today. */
export const workflowRunRepoOf = (
  run: { githubRunUrl?: string | null },
  fallback: string,
): string => repoFromGithubUrl(run.githubRunUrl) ?? fallback;
