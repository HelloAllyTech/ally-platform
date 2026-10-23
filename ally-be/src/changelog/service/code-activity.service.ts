import { Injectable } from '@nestjs/common';
import axios from 'axios';

import { isoDate } from 'src/analytics/util/analytics-window.util';
import { AppConfigService } from 'src/config/config.service';
import { MONOREPO_SERVICES } from 'src/github/service/github-actions.service';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';

import {
  CODE_ACTIVITY_CLOSED_MONTH_REFRESH_MS,
  CODE_ACTIVITY_CURRENT_MONTH_REFRESH_MS,
  CODE_ACTIVITY_DEFAULT_DAYS,
  CODE_ACTIVITY_EARLIEST_DATE,
  CODE_ACTIVITY_MAX_DAYS,
  CODE_ACTIVITY_MAX_PAGES_PER_MONTH,
  CODE_ACTIVITY_REPOS,
  CODE_ACTIVITY_SETTLE_MS,
  MONOREPO_CUTOVER,
  MONOREPO_SHARED_BUCKET,
  MOVED_TO_MONOREPO,
  codeActivityCacheKey,
  monorepoActivityCacheKey,
} from '../constants/code-activity.constants';
import {
  CodeActivityDayDto,
  CodeActivityResponseDto,
  GetPublicCodeActivityDto,
} from '../dto/code-activity.dto';

/** `date -> [added, deleted]` for one repo's one month. */
export type DailyTotals = Record<string, [number, number]>;

export interface MonthBlock {
  fetchedAt: number;
  days: DailyTotals;
}

/** `date -> bucket -> [added, deleted]` for the monorepo's one month (see monorepoMonth). */
export type BucketedDailyTotals = Record<
  string,
  Record<string, [number, number]>
>;

interface BucketedMonthBlock {
  fetchedAt: number;
  days: BucketedDailyTotals;
}

/** Daily totals per repo — a legacy repo, or a monorepo bucket named after the repo it continues. */
export interface DailyByRepo {
  byRepo: Record<string, DailyTotals>;
  /** A repo-month could be neither fetched nor recovered from cache. */
  incomplete: boolean;
}

/**
 * The folders whose monorepo commits continue a repo's series: the five
 * services, and the wiki source (its own repo now only mirrors this folder).
 */
const MONOREPO_ATTRIBUTION_FOLDERS: readonly string[] = [
  ...MONOREPO_SERVICES,
  'helloallytech.github.io',
];

interface HistoryNode {
  oid: string;
  committedDate: string;
  additions: number;
  deletions: number;
  parents: { totalCount: number };
}

interface HistoryPage {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: HistoryNode[];
}

const GITHUB_GRAPHQL = 'https://api.github.com/graphql';
/** The last second a repo that moved is read for (GraphQL `until` is inclusive). */
const JUST_BEFORE_CUTOVER = new Date(Date.parse(MONOREPO_CUTOVER) - 1000)
  .toISOString()
  .replace('.000', '');
const REQUEST_TIMEOUT_MS = 30_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const HISTORY_QUERY = `
  query CodeActivity(
    $owner: String!
    $name: String!
    $since: GitTimestamp!
    $until: GitTimestamp!
    $after: String
    $path: String
  ) {
    repository(owner: $owner, name: $name) {
      defaultBranchRef {
        target {
          ... on Commit {
            history(
              first: 100
              since: $since
              until: $until
              after: $after
              path: $path
            ) {
              pageInfo { hasNextPage endCursor }
              nodes {
                oid
                committedDate
                additions
                deletions
                parents { totalCount }
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Daily changed-line volume across the Ally repos, for the heatmap on the
 * public changelog page. The admin ship-volume chart's measure at a finer
 * grain, summed across repos — a public page gets the total, never the split.
 *
 * ## Why not the ship-volume chart's source
 *
 * That chart reads GitHub's `/stats/code_frequency`, which is weekly and
 * cannot be cut finer. Days need per-commit numbers, and GraphQL's commit
 * `history` carries `additions`/`deletions` per commit, 100 to a page — no
 * per-commit REST call, no clone. Merge commits are skipped: their diff is
 * the branch's commits again. What is left matches
 * `git log --no-merges --numstat` on the default branch exactly (checked on
 * ally-be for the week of 2026-09-13: 25,437 both ways) and a first-parent
 * walk to within 1%. Days are UTC and bucketed by commit date, which is what
 * GraphQL's `since`/`until` filter on.
 *
 * ## Why a Redis block per repo per month
 *
 * GitHub computes those line counts on demand, at roughly three seconds a
 * page; a busy repo-month is five or six pages. A public page cannot pay that
 * per reader, so each repo-month is read once and kept. A closed month barely
 * changes (a late-merged branch can still add to it, hence the settle window
 * in the constants) and, once settled, is never read again; the month in
 * progress is re-read every few minutes. A stale block is served straight
 * away and refreshed behind the response, so only the very first reader of a
 * month waits.
 *
 * ## Honesty
 *
 * Repos are summed, so a repo that cannot be read shortens every day with no
 * visible sign. A repo-month that could be neither fetched nor recovered from
 * cache sets `incomplete`, and the page is expected to say so.
 */
@Injectable()
export class CodeActivityService {
  private readonly logger = LoggerService.getInstance(CodeActivityService.name);

  /** Single-flight per repo-month: concurrent readers share one fetch. */
  private readonly inflight = new Map<string, Promise<MonthBlock | null>>();

  private warnedNoToken = false;

  constructor(
    private readonly configService: AppConfigService,
    private readonly redisService: RedisService,
  ) {}

  async getActivity(
    query: GetPublicCodeActivityDto = {},
  ): Promise<CodeActivityResponseDto> {
    const now = new Date();
    const today = isoDate(now);
    const until = clampDate(
      query.until ?? today,
      CODE_ACTIVITY_EARLIEST_DATE,
      today,
    );
    const length = Math.min(
      CODE_ACTIVITY_MAX_DAYS,
      Math.max(1, Math.trunc(query.days ?? CODE_ACTIVITY_DEFAULT_DAYS)),
    );
    const from = clampDate(
      addDays(until, -(length - 1)),
      CODE_ACTIVITY_EARLIEST_DATE,
      until,
    );

    const axis = dateRange(from, until);
    const months = [...new Set(axis.map((date) => date.slice(0, 7)))];

    const { byRepo, incomplete } = await this.dailyByRepo(
      months,
      now.getTime(),
    );

    const totals = new Map<string, [number, number]>();
    for (const days of Object.values(byRepo)) {
      for (const [date, [added, deleted]] of Object.entries(days)) {
        const cell = totals.get(date) ?? [0, 0];
        cell[0] += added;
        cell[1] += deleted;
        totals.set(date, cell);
      }
    }

    const days: CodeActivityDayDto[] = axis.map((date) => {
      const [added, deleted] = totals.get(date) ?? [0, 0];
      return {
        date,
        added,
        deleted,
        churn: added + deleted,
        partial: date === today,
      };
    });

    return {
      days,
      from,
      until,
      today,
      earliestDate: CODE_ACTIVITY_EARLIEST_DATE,
      hasOlder: from > CODE_ACTIVITY_EARLIEST_DATE,
      incomplete,
      computedAt: now.toISOString(),
    };
  }

  /**
   * Daily changed lines per repo for whole UTC months — the heatmap's source,
   * and the admin ship-volume chart's from the week of the monorepo cutover.
   *
   * Each repo is read on its side of `MONOREPO_CUTOVER`: the repos that moved
   * up to it, the monorepo after it, `infra` throughout. The monorepo's
   * commits continue the series of the repo whose folder they touched (see
   * monorepoMonth), so a reader sees one unbroken history per repo, plus
   * `ally-platform` for work that belongs to no single one.
   */
  async dailyByRepo(months: string[], now = Date.now()): Promise<DailyByRepo> {
    const byRepo: Record<string, DailyTotals> = {};
    const add = (
      repo: string,
      date: string,
      [added, deleted]: [number, number],
    ) => {
      const days = (byRepo[repo] ??= {});
      const cell = (days[date] ??= [0, 0]);
      cell[0] += added;
      cell[1] += deleted;
    };

    const [legacy, monorepo] = await Promise.all([
      Promise.all(
        CODE_ACTIVITY_REPOS.flatMap((repo) =>
          months.map(async (month) => ({
            repo,
            days: await this.loadMonth(repo, month, now),
          })),
        ),
      ),
      this.configService.githubMonorepo
        ? Promise.all(months.map((month) => this.monorepoMonth(month, now)))
        : Promise.resolve([] as (BucketedDailyTotals | null)[]),
    ]);

    let incomplete = false;
    for (const { repo, days } of legacy) {
      if (!days) {
        incomplete = true;
        continue;
      }
      for (const [date, cell] of Object.entries(days)) add(repo, date, cell);
    }
    for (const days of monorepo) {
      if (!days) {
        incomplete = true;
        continue;
      }
      for (const [date, buckets] of Object.entries(days)) {
        for (const [bucket, cell] of Object.entries(buckets)) {
          add(bucket, date, cell);
        }
      }
    }
    return { byRepo, incomplete };
  }

  /**
   * The monorepo's own work in one UTC month, per day and per bucket.
   *
   * Only commits after `MONOREPO_CUTOVER` count: before it, the monorepo's
   * history is the imported history of the old repos, already counted there.
   * Merge commits are skipped, as everywhere here.
   *
   * GitHub's line counts are per COMMIT, and `history(path:)` only selects
   * commits — a commit touching `ally-be/` and `ally-web/` carries its whole
   * diff in both lists. So every commit is counted once, from the unfiltered
   * history, and attributed by which folders' histories list it: exactly one
   * folder → that repo's series; none (root files: CI, scripts) or several →
   * `MONOREPO_SHARED_BUCKET`. Cached and refreshed like a repo-month.
   */
  async monorepoMonth(
    month: string,
    now = Date.now(),
  ): Promise<BucketedDailyTotals | null> {
    const monorepo = this.configService.githubMonorepo;
    const { until } = monthBounds(month);
    if (!monorepo || until < MONOREPO_CUTOVER) return {};

    const key = monorepoActivityCacheKey(month);
    const cached = (await this.readCache(key)) as BucketedMonthBlock | null;
    if (cached && isFresh(cached as unknown as MonthBlock, month, now)) {
      return cached.days;
    }
    if (!this.configService.githubToken) return cached?.days ?? null;

    const refresh = this.single(key, async () => {
      const days = await this.fetchMonorepoMonth(monorepo, month);
      const block: BucketedMonthBlock = { fetchedAt: Date.now(), days };
      await this.writeCache(key, block as unknown as MonthBlock);
      return block;
    });
    if (cached) {
      void refresh;
      return cached.days;
    }
    return ((await refresh) as BucketedMonthBlock | null)?.days ?? null;
  }

  private async fetchMonorepoMonth(
    monorepo: string,
    month: string,
  ): Promise<BucketedDailyTotals> {
    const bounds = monthBounds(month);
    const since =
      bounds.since > MONOREPO_CUTOVER ? bounds.since : MONOREPO_CUTOVER;

    const [commits, ...folderOids] = await Promise.all([
      this.fetchHistory(monorepo, since, bounds.until, null),
      ...MONOREPO_ATTRIBUTION_FOLDERS.map((folder) =>
        this.fetchHistory(monorepo, since, bounds.until, `${folder}/`),
      ),
    ]);
    const folderOf = new Map<string, string[]>();
    MONOREPO_ATTRIBUTION_FOLDERS.forEach((folder, index) => {
      for (const node of folderOids[index]) {
        folderOf.set(node.oid, [...(folderOf.get(node.oid) ?? []), folder]);
      }
    });

    const days: BucketedDailyTotals = {};
    for (const node of commits) {
      if (node.parents.totalCount > 1) continue;
      const date = isoDate(new Date(node.committedDate));
      if (!date.startsWith(month)) continue;
      const folders = folderOf.get(node.oid) ?? [];
      const bucket = folders.length === 1 ? folders[0] : MONOREPO_SHARED_BUCKET;
      const cell = ((days[date] ??= {})[bucket] ??= [0, 0]);
      cell[0] += node.additions;
      cell[1] += node.deletions;
    }
    return days;
  }

  /** Every commit in a window of one repo's default branch (optionally under a path). */
  private async fetchHistory(
    repo: string,
    since: string,
    until: string,
    path: string | null,
  ): Promise<HistoryNode[]> {
    const nodes: HistoryNode[] = [];
    let after: string | null = null;
    for (let page = 0; page < CODE_ACTIVITY_MAX_PAGES_PER_MONTH; page++) {
      const history = await this.fetchHistoryPage(
        repo,
        since,
        until,
        after,
        path,
      );
      if (!history) return nodes;
      nodes.push(...history.nodes);
      if (!history.pageInfo.hasNextPage) return nodes;
      after = history.pageInfo.endCursor;
    }
    throw new Error(
      `more than ${CODE_ACTIVITY_MAX_PAGES_PER_MONTH} pages of history — refusing a truncated month`,
    );
  }

  /** Single-flight: concurrent readers of one cache key share one fetch. Never rejects. */
  private single(
    key: string,
    work: () => Promise<MonthBlock | BucketedMonthBlock>,
  ): Promise<MonthBlock | BucketedMonthBlock | null> {
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<MonthBlock | null>;
    const pending = work()
      .catch((error: unknown) => {
        this.logger.error(
          `code-activity: could not read ${key}: ${
            (error as Error)?.message ?? String(error)
          }`,
        );
        return null;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, pending as Promise<MonthBlock | null>);
    return pending;
  }

  /**
   * The window of a month a repo is read for: the whole month, or — for a
   * repo that moved into the monorepo — only up to the cutover, and nothing
   * at all after it.
   */
  private legacyWindow(
    repo: string,
    month: string,
  ): { since: string; until: string } | null {
    const bounds = monthBounds(month);
    if (
      !this.configService.githubMonorepo ||
      !MOVED_TO_MONOREPO.includes(repo)
    ) {
      return bounds;
    }
    if (bounds.since >= MONOREPO_CUTOVER) return null;
    return bounds.until < MONOREPO_CUTOVER
      ? bounds
      : { since: bounds.since, until: JUST_BEFORE_CUTOVER };
  }

  /**
   * One repo's daily totals for one month, from cache where it is fresh
   * enough, or `null` when there is nothing to serve.
   */
  private async loadMonth(
    repo: string,
    month: string,
    now: number,
  ): Promise<DailyTotals | null> {
    // A repo that moved into the monorepo has nothing after the cutover; its
    // work there is the monorepo's (monorepoMonth).
    if (!this.legacyWindow(repo, month)) return {};
    const key = codeActivityCacheKey(repo, month);
    const cached = await this.readCache(key);

    if (cached && isFresh(cached, month, now)) return cached.days;

    if (!this.configService.githubToken) {
      if (!this.warnedNoToken) {
        this.warnedNoToken = true;
        this.logger.warn(
          'GITHUB_TOKEN is not set; the changelog code-activity heatmap has no data source in this environment',
        );
      }
      return cached?.days ?? null;
    }

    if (cached) {
      // Stale but usable: answer now, refresh behind the response.
      void this.refreshMonth(repo, month, key);
      return cached.days;
    }

    const fetched = await this.refreshMonth(repo, month, key);
    return fetched?.days ?? null;
  }

  /** Never rejects — a failed refresh resolves `null` and is logged. */
  private refreshMonth(
    repo: string,
    month: string,
    key: string,
  ): Promise<MonthBlock | null> {
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const pending = this.fetchMonth(repo, month)
      .then(async (days) => {
        const block: MonthBlock = { fetchedAt: Date.now(), days };
        await this.writeCache(key, block);
        return block;
      })
      .catch((error: unknown) => {
        this.logger.error(
          `code-activity: could not read ${repo} for ${month}: ${
            (error as Error)?.message ?? String(error)
          }`,
        );
        return null;
      })
      .finally(() => this.inflight.delete(key));

    this.inflight.set(key, pending);
    return pending;
  }

  private async fetchMonth(repo: string, month: string): Promise<DailyTotals> {
    const window = this.legacyWindow(repo, month);
    const days: DailyTotals = {};
    if (!window) return days;
    const { since, until } = window;
    let after: string | null = null;

    for (let page = 0; page < CODE_ACTIVITY_MAX_PAGES_PER_MONTH; page++) {
      const history = await this.fetchHistoryPage(repo, since, until, after);
      // An empty repository has no default branch, and so nothing to count.
      if (!history) return days;

      for (const node of history.nodes) {
        if (node.parents.totalCount > 1) continue;
        const date = isoDate(new Date(node.committedDate));
        if (!date.startsWith(month)) continue;
        const cell = days[date] ?? [0, 0];
        cell[0] += node.additions;
        cell[1] += node.deletions;
        days[date] = cell;
      }

      if (!history.pageInfo.hasNextPage) return days;
      after = history.pageInfo.endCursor;
    }

    // Caching a truncated month would make it wrong for good, since a settled
    // month is never read again.
    throw new Error(
      `more than ${CODE_ACTIVITY_MAX_PAGES_PER_MONTH} pages of history — refusing a truncated month`,
    );
  }

  private async fetchHistoryPage(
    repo: string,
    since: string,
    until: string,
    after: string | null,
    path: string | null = null,
  ): Promise<HistoryPage | null> {
    const org = this.configService.githubOrg;
    const { data } = await axios.post(
      GITHUB_GRAPHQL,
      {
        query: HISTORY_QUERY,
        variables: { owner: org, name: repo, since, until, after, path },
      },
      {
        headers: {
          Authorization: `Bearer ${this.configService.githubToken}`,
          'Content-Type': 'application/json',
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
    );

    // GraphQL reports failure in the body of a 200.
    if (data?.errors?.length) {
      throw new Error(`GitHub GraphQL error: ${data.errors[0]?.message}`);
    }
    const repository = data?.data?.repository;
    if (!repository) {
      // A private repo the token cannot see reads as "no such repository".
      throw new Error(
        `GitHub returned no repository for ${org}/${repo} — the token probably cannot see it`,
      );
    }
    return repository.defaultBranchRef?.target?.history ?? null;
  }

  private async readCache(key: string): Promise<MonthBlock | null> {
    try {
      const raw = await this.redisService.get(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as MonthBlock;
      return typeof parsed?.fetchedAt === 'number' && parsed.days
        ? parsed
        : null;
    } catch (error) {
      this.logger.warn(
        `code-activity: could not read cache ${key}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * No TTL: freshness is decided by `fetchedAt`, and the stored copy is also
   * the fallback when GitHub cannot be reached. An expiring key would throw it
   * away exactly then.
   */
  private async writeCache(key: string, block: MonthBlock): Promise<void> {
    try {
      await this.redisService.set(key, JSON.stringify(block));
    } catch (error) {
      this.logger.warn(
        `code-activity: could not cache ${key}: ${(error as Error).message}`,
      );
    }
  }
}

/** Exclusive end of a `yyyy-mm` month, as epoch ms. */
const monthEndMs = (month: string): number => {
  const [year, m] = month.split('-').map(Number);
  return Date.UTC(year, m, 1);
};

/** GraphQL `since`/`until` for a whole UTC month (both inclusive). */
export const monthBounds = (
  month: string,
): { since: string; until: string } => ({
  since: `${month}-01T00:00:00Z`,
  until: new Date(monthEndMs(month) - 1000).toISOString().replace('.000', ''),
});

/**
 * A block is final once it was read after its month settled; before that it
 * is fresh for a while depending on whether the month is still in progress.
 */
export const isFresh = (
  block: MonthBlock,
  month: string,
  now: number,
): boolean => {
  const end = monthEndMs(month);
  if (block.fetchedAt >= end + CODE_ACTIVITY_SETTLE_MS) return true;
  const refreshAfter =
    now < end
      ? CODE_ACTIVITY_CURRENT_MONTH_REFRESH_MS
      : CODE_ACTIVITY_CLOSED_MONTH_REFRESH_MS;
  return now - block.fetchedAt < refreshAfter;
};

const addDays = (date: string, n: number): string =>
  isoDate(new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS));

/**
 * Clamps a yyyy-mm-dd string into [min, max]. A string that is not a real
 * date (2026-02-31 passes the DTO's pattern) falls back to `max`.
 */
const clampDate = (date: string, min: string, max: string): string => {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed) || isoDate(new Date(parsed)) !== date) return max;
  if (date < min) return min;
  if (date > max) return max;
  return date;
};

/** Every date from `from` to `until`, inclusive, oldest first. */
const dateRange = (from: string, until: string): string[] => {
  const out: string[] = [];
  for (let d = from; d <= until; d = addDays(d, 1)) out.push(d);
  return out;
};
