import { shippedApp } from 'src/release/constants/release-targets.constants';

/**
 * The deterministic half of release tracking (`ItemReleaseService`): which
 * opportunity a pull request names, which release run and tag count, and
 * when an opportunity has shipped. No I/O here, so every rule is testable on
 * its own.
 */

// ── Opportunity codes ────────────────────────────────────────────────────────

/**
 * `OPP-0042`, `OPP-388`, `opp-388-add-thing`: the code wherever it appears in
 * a PR title or branch name. A word boundary on both sides, but drawn by hand
 * rather than `\b`: `_` is a word character to `\b`, and a branch like
 * `feat_opp-12` should match, while `shopp-12` and `OPP-123` inside
 * `OPP-1234` must not.
 */
const CODE_PATTERN = /(?<![A-Za-z0-9])OPP-(\d{1,7})(?![0-9])/gi;

/** The stored form of a code: `OPP-` and at least four digits, as the column default writes it. */
export function formatOpportunityCode(digits: string | number): string {
  return `OPP-${String(Number(digits)).padStart(4, '0')}`;
}

/** Every distinct opportunity code a text names, in stored form. */
export function extractOpportunityCodes(
  text: string | null | undefined,
): string[] {
  const found = new Set<string>();
  for (const match of (text ?? '').matchAll(CODE_PATTERN)) {
    if (Number(match[1]) > 0) found.add(formatOpportunityCode(match[1]));
  }
  return [...found];
}

/** A code as a person typed it in a URL (`opp-388`, `OPP-0388`, `388`), in stored form; null if it is not one. */
export function normaliseOpportunityCode(input: string): string | null {
  const match = /^(?:OPP-)?(\d{1,7})$/i.exec(input.trim());
  return match && Number(match[1]) > 0 ? formatOpportunityCode(match[1]) : null;
}

// ── Pull request references ──────────────────────────────────────────────────

/**
 * A pull request as a person pastes it: a github.com URL or a bare number
 * (`388`, `#388`), which means the monorepo. Null for anything else.
 */
export function parsePullRequestRef(
  input: string,
  defaultRepo: string,
): { repo: string; number: number } | null {
  const text = input.trim();
  const bare = /^#?(\d{1,7})$/.exec(text);
  if (bare) return { repo: defaultRepo, number: Number(bare[1]) };
  const url =
    /^https?:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/pull\/(\d{1,7})(?:[/?#].*)?$/i.exec(
      text,
    );
  return url ? { repo: `${url[1]}/${url[2]}`, number: Number(url[3]) } : null;
}

// ── Release history ──────────────────────────────────────────────────────────

/** The fields of a completed workflow run this module reads. */
export interface ReleaseRunLike {
  conclusion: string | null;
  createdAt: Date;
  startedAt: Date;
  finishedAt: Date;
  headSha: string | null;
  title: string;
}

/** A tag with the commit it names and when it was made. */
export interface ResolvedTag {
  name: string;
  commitSha: string;
  at: Date;
}

/** Semantic version of a tag after its prefix, for ordering. Null when it is not `X.Y.Z`. */
export function tagVersion(name: string, prefix: string): number[] | null {
  if (!name.startsWith(prefix)) return null;
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(name.slice(prefix.length));
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Tag names with `prefix`, newest version first; names that are not `X.Y.Z` are dropped. */
export function sortTagsNewestFirst(names: string[], prefix: string): string[] {
  return names
    .map((name) => ({ name, version: tagVersion(name, prefix) }))
    .filter(
      (entry): entry is { name: string; version: number[] } =>
        entry.version !== null,
    )
    .sort(
      (a, b) =>
        b.version[0] - a.version[0] ||
        b.version[1] - a.version[1] ||
        b.version[2] - a.version[2],
    )
    .map((entry) => entry.name);
}

const isSuccess = (run: ReleaseRunLike) => run.conclusion === 'success';

/**
 * Whether a run of the shared frontends workflow shipped `app`. `both` needs
 * a run that shipped both, which is what the `[apps=…]` marker decides.
 */
function shipped(run: ReleaseRunLike, app: string | undefined): boolean {
  return shippedApp(run.title, app);
}

/**
 * The newest successful run, optionally of one frontend app. A failed run is
 * never it: `validate-and-tag` runs before tests, so a release that died in
 * its tests or deploy still leaves a tag behind, and that tag shipped nothing.
 */
export function newestSuccessfulRun<T extends ReleaseRunLike>(
  runs: readonly T[],
  app?: string,
): T | null {
  let best: T | null = null;
  for (const run of runs) {
    if (!isSuccess(run) || !shipped(run, app)) continue;
    if (!best || run.startedAt.getTime() > best.startedAt.getTime()) best = run;
  }
  return best;
}

/** The frontends workflow names its tag in the run title (`run-name`). */
export function tagFromRunTitle(title: string, prefix: string): string | null {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return (
    new RegExp(`(?:^|\\s)(${escaped}\\d+\\.\\d+\\.\\d+)(?:\\s|$)`).exec(
      title,
    )?.[1] ?? null
  );
}

/**
 * Two minutes either side of a run's window. The tag's date comes from the
 * runner's clock and the run's from GitHub's; they agree to seconds, and the
 * slack keeps a run whose first job started instantly from losing its tag.
 */
const TAG_WINDOW_SLACK_MS = 2 * 60 * 1000;

/**
 * The tag a release run made: the newest one dated inside the run.
 *
 * The backend and AI workflows create their tag in their first job, and
 * their run titles do not carry it, so a run and its tag are matched by time.
 * `createdAt` rather than `startedAt` as the lower bound: re-running a failed
 * deploy job moves `run_started_at` to the re-run while the tag keeps the
 * first attempt's date.
 */
export function tagCreatedDuring(
  tags: readonly ResolvedTag[],
  run: ReleaseRunLike,
): ResolvedTag | null {
  const from = run.createdAt.getTime() - TAG_WINDOW_SLACK_MS;
  const to = run.finishedAt.getTime() + TAG_WINDOW_SLACK_MS;
  let best: ResolvedTag | null = null;
  for (const tag of tags) {
    const at = tag.at.getTime();
    if (at < from || at > to) continue;
    if (!best || at > best.at.getTime()) best = tag;
  }
  return best;
}

/**
 * When a change merged at `mergedAt` first went out: the end of the first
 * successful release that STARTED after the merge (the rule product-update
 * liveness and Builder already use — a release builds the branch head as it
 * starts, so one that began earlier cannot contain the merge). Null when that
 * release is older than the history read.
 */
export function firstReleaseAfter(
  runs: readonly ReleaseRunLike[],
  mergedAt: Date,
  app?: string,
): Date | null {
  let best: ReleaseRunLike | null = null;
  for (const run of runs) {
    if (!isSuccess(run) || !shipped(run, app)) continue;
    if (run.startedAt.getTime() < mergedAt.getTime()) continue;
    if (!best || run.startedAt.getTime() < best.startedAt.getTime()) best = run;
  }
  return best?.finishedAt ?? null;
}

const FAILED_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure']);

/**
 * Merged but not deployed: the newest release that started after the merge
 * failed. A later success clears it (that is the newest), and so does
 * nothing having run yet (that is just "waiting").
 */
export function releaseFailedSince(
  runs: readonly ReleaseRunLike[],
  mergedAt: Date,
  app?: string,
): boolean {
  let newest: ReleaseRunLike | null = null;
  for (const run of runs) {
    if (run.startedAt.getTime() < mergedAt.getTime()) continue;
    if (!shipped(run, app)) continue;
    if (run.conclusion === 'cancelled' || run.conclusion === 'skipped') {
      continue;
    }
    if (!newest || run.startedAt.getTime() > newest.startedAt.getTime()) {
      newest = run;
    }
  }
  return Boolean(newest && FAILED_CONCLUSIONS.has(newest.conclusion ?? ''));
}

/** GitHub's compare status for `compare/{release}...{merge}`: the merge is in the release. */
export function containedIn(status: string | null): boolean {
  return status === 'behind' || status === 'identical';
}

// ── The shipped rule ─────────────────────────────────────────────────────────

export interface LinkForShipping {
  repo: string;
  prNumber: number;
  /** open | merged | closed. */
  state: string;
  /** Set once the merged PR's services have been written as release rows. */
  servicesResolvedAt?: Date | null;
}

export interface ReleaseForShipping {
  repo: string;
  prNumber: number;
  /** pending | live | failed. */
  state: string;
  releasedAt?: Date | null;
}

/**
 * Shipped = every touched service is live, for every pull request that
 * delivered the work.
 *
 *  - At least one linked pull request has merged. An opportunity with links
 *    but nothing merged has delivered nothing.
 *  - None is still open: an epic whose second milestone is in review has not
 *    shipped.
 *  - A pull request closed without merging is a rejection and is ignored. It
 *    neither ships the work nor holds it back.
 *  - Every merged one has had its services worked out, and every release row
 *    it produced is live. A row that is pending or failed holds it — `skipped`
 *    is not a state here, so nothing can count as delivered without a release
 *    that contains it.
 *
 * `liveAt` is when the last of them went live, or null when any of those
 * times is unknown (the release was older than the history read).
 */
export function opportunityShipped(
  links: readonly LinkForShipping[],
  releases: readonly ReleaseForShipping[],
): { shipped: boolean; liveAt: Date | null } {
  const no = { shipped: false, liveAt: null };
  const merged = links.filter((link) => link.state === 'merged');
  if (merged.length === 0) return no;
  if (
    links.some((link) => link.state !== 'merged' && link.state !== 'closed')
  ) {
    return no;
  }

  let liveAt: Date | null = new Date(0);
  for (const link of merged) {
    if (!link.servicesResolvedAt) return no;
    const rows = releases.filter(
      (row) => row.repo === link.repo && row.prNumber === link.prNumber,
    );
    if (rows.length === 0) return no;
    for (const row of rows) {
      if (row.state !== 'live') return no;
      if (!row.releasedAt) liveAt = null;
      else if (liveAt && row.releasedAt.getTime() > liveAt.getTime()) {
        liveAt = row.releasedAt;
      }
    }
  }
  return { shipped: true, liveAt };
}
