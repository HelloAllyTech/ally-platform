import { SHIP_VOLUME_REPOS } from 'src/analytics/constants/ship-volume.constants';

/**
 * The repos whose daily churn the public changelog's heatmap sums.
 *
 * The same population as the admin ship-volume chart, on purpose: the two are
 * the same measure at two grains (a week there, a day here), and a figure that
 * silently covered a different set of repos would disagree with it for no
 * reason a reader could see. Add a repo there and it appears here too.
 */
export const CODE_ACTIVITY_REPOS = SHIP_VOLUME_REPOS;

/**
 * The first day any of those repos has a commit (`ally-mobile`, 2025-04-23).
 * The heatmap stops loading older days here rather than paging on through
 * empty months to the epoch.
 */
export const CODE_ACTIVITY_EARLIEST_DATE = '2025-04-23';

export const CODE_ACTIVITY_DEFAULT_DAYS = 30;

/** Enough for a quarter per request; a window touches at most 4 months. */
export const CODE_ACTIVITY_MAX_DAYS = 92;

/** How often the month in progress is re-read from GitHub. */
export const CODE_ACTIVITY_CURRENT_MONTH_REFRESH_MS = 10 * 60 * 1000;

/** How often a recently closed month is re-read (see SETTLE below). */
export const CODE_ACTIVITY_CLOSED_MONTH_REFRESH_MS = 6 * 60 * 60 * 1000;

/**
 * How long after a month ends before its numbers are treated as final.
 *
 * Days are bucketed by commit date, and a PR landed with a merge commit keeps
 * its branch commits' original dates — so a branch merged on the 5th adds lines
 * to days in the previous month. Past this point a month is read once more and
 * then never again.
 */
export const CODE_ACTIVITY_SETTLE_MS = 45 * 24 * 60 * 60 * 1000;

/**
 * Safety cap on history pages per repo-month (100 commits each). Busy months
 * run to ~6 pages; hitting the cap means something is wrong, and the month is
 * refused rather than cached truncated.
 */
export const CODE_ACTIVITY_MAX_PAGES_PER_MONTH = 100;

/** Redis key for one repo's daily totals for one UTC month (`yyyy-mm`). */
export const codeActivityCacheKey = (repo: string, month: string): string =>
  `changelog:code-activity:v1:${repo}:${month}`;

/**
 * The instant the last service history was imported into the monorepo
 * (2026-10-23, `Merge 'ally-ai-learn/' …` at 05:21:16 UTC).
 *
 * Before it, each service's work is its own repo's history; those repos are
 * archived and frozen. After it, the work is the monorepo's own commits. The
 * monorepo also CONTAINS the imported history — every old commit, with its
 * original date — so reading it before this instant would count everything
 * twice. Each source is read on its side of the line, and nothing is counted
 * on both.
 */
export const MONOREPO_CUTOVER = '2026-10-23T05:21:17Z';

/**
 * Repos whose work moved into the monorepo at the cutover: read only up to
 * it. The five services are archived; the wiki repo is still live, but since
 * the move it only receives publish commits mirroring the monorepo's
 * `helloallytech.github.io/` folder, which would count the same lines twice.
 */
export const MOVED_TO_MONOREPO: readonly string[] = [
  'ally-be',
  'ally-web',
  'ally-ai',
  'ally-ai-learn',
  'ally-mobile',
  'helloallytech.github.io',
];

/**
 * The bucket for monorepo work that belongs to no single repo above: root
 * files (CI, scripts) and commits that touch several services at once. Named
 * after the monorepo, because that is where it happened.
 */
export const MONOREPO_SHARED_BUCKET = 'ally-platform';

/** Redis key for the monorepo's bucketed daily totals for one UTC month. */
export const monorepoActivityCacheKey = (month: string): string =>
  `changelog:code-activity:v1:monorepo:${month}`;
