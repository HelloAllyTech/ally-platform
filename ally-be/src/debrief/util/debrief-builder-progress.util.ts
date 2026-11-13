/**
 * "Hand to Builder" (R2-20, plan §11.5): who answers Builder's interview, and where a
 * handed-over idea stands in Builder, in the five steps the idea card shows.
 */

/** Who answers Builder's interview questions for a handed-over idea. */
export type BuilderAnswerer = 'pm_agent' | 'person';

export const BUILDER_ANSWERERS: readonly BuilderAnswerer[] = [
  'pm_agent',
  'person',
];

/** In Builder: interviewing · building · PR open · merged · closed. */
export type BuilderProgressStage =
  | 'interviewing'
  | 'building'
  | 'pr_open'
  | 'merged'
  | 'closed';

export interface BuilderPullRequestState {
  state: string | null;
  merged: boolean;
}

/**
 * The idea card's stage from the Builder session's real status and its pull
 * requests. A pull request outranks the status: a session still BUILDING while
 * fix rounds run on an open PR reads "PR open", and one whose PRs all merged
 * reads "merged" whatever the session row says. A session gone (deleted) is closed.
 */
export function builderProgressStage(
  status: string | null | undefined,
  pullRequests: BuilderPullRequestState[],
): BuilderProgressStage {
  const open = pullRequests.filter(
    (pr) => !pr.merged && (pr.state ?? 'open') === 'open',
  );
  if (open.length) return 'pr_open';
  if (pullRequests.some((pr) => pr.merged)) return 'merged';
  switch (status) {
    case 'INTERVIEWING':
    case 'PRD_READY':
      return 'interviewing';
    case 'BUILDING':
    case 'WAITING_FOR_INPUT':
      return 'building';
    default:
      // COMPLETED with no PR or only closed ones, FAILED, CANCELLED, or gone.
      return 'closed';
  }
}

/** Past this many answers on one session, the PM agent leaves the rest to the person. */
export const BUILDER_ANSWERS_PER_SESSION = 20;

/** One answer never spends more than this from the learning budget. */
export const BUILDER_ANSWER_CAP_USD = 0.1;
