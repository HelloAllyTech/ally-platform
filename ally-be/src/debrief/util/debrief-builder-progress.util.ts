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

/** One of a Builder session's pull requests, as delivery reads it. */
export interface BuilderPullRequestDelivery {
  repo: string;
  prNumber: number;
  merged: boolean;
  state: string | null;
  mergedAt: Date | string | null;
  releaseState: string | null;
  releasedAt: Date | string | null;
  releaseTag: string | null;
}

export interface BuilderDelivery {
  /** When the last of the merged changes reached production. */
  at: string;
  releaseTags: string[];
  pullRequests: Array<{ repo: string; number: number }>;
}

/**
 * A Builder idea's change is delivered when every pull request of its session
 * is closed or merged, at least one merged, and each merged one reached
 * production: Builder's `released`, or `skipped` for a repo with no release
 * pipeline (then the merge is the nearest time we know). Null while any is
 * still open, releasing, or failed or unhealthy after release — a person has
 * to act on those, and nothing is measured until they do.
 */
export function builderDelivery(
  prs: BuilderPullRequestDelivery[],
): BuilderDelivery | null {
  const open = prs.filter((p) => !p.merged && (p.state ?? 'open') === 'open');
  const merged = prs.filter((p) => p.merged);
  if (open.length || !merged.length) return null;
  if (
    merged.some(
      (p) => p.releaseState !== 'released' && p.releaseState !== 'skipped',
    )
  ) {
    return null;
  }
  const times = merged
    .map((p) =>
      new Date(
        (p.releaseState === 'released' ? p.releasedAt : null) ??
          p.mergedAt ??
          0,
      ).getTime(),
    )
    .filter((t) => t > 0);
  if (!times.length) return null;
  return {
    at: new Date(Math.max(...times)).toISOString(),
    releaseTags: merged
      .map((p) => p.releaseTag)
      .filter((t): t is string => !!t),
    pullRequests: merged.map((p) => ({ repo: p.repo, number: p.prNumber })),
  };
}
