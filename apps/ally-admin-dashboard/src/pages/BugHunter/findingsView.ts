import { BugFinding, BugFindingSeverity, BugFindingSource, BugFindingStatus } from "@types";

import {
  BucketCounts,
  bucketOf,
  bucketOfStatus,
  countByBucket,
  IN_FLIGHT_STATUSES,
  LIFECYCLE_BUCKETS,
  LifecycleBucket,
} from "./lifecycleBucket";
import { ageInDays, STALENESS_DAYS } from "./triage";

/**
 * Turning the loaded window of findings into the rows on screen: filter, sort,
 * flag duplicates, paginate.
 *
 * ## Why all of this is client-side
 *
 * `GET /findings` filters by one status, one source and one repo, and knows
 * nothing about free-text search, severity or the five lifecycle tabs. It
 * could learn — but every surface on this page (the header's status line, the
 * tab counts, this table) needs the *same* hundred findings, and they
 * ordinarily share exactly one RTK Query cache entry because they all ask for
 * `{status: "all", limit: 100}`. Pushing filters into the query would fork that
 * entry per filter combination and turn one request into several, to sift a
 * list small enough that the sifting is free.
 *
 * So the window stays server-side (newest 100, or more once a reader has
 * clicked "Load more" — see `BugFindingsTable`'s `limit` state) and everything
 * inside it is computed here. The honest consequence is that filters describe
 * the window and not the whole table, which is why `FindingsView.windowed`
 * exists: the table states it in words rather than letting a reader assume a
 * filter searched history.
 *
 * ## Every facet is multi-select
 *
 * "Everything in ally-be *and* ally-web" is one triage pass, and a
 * one-repo-at-a-time facet turns it into two passes whose results you have to
 * hold in your head. An empty array means "don't filter on this", so the
 * absent case stays free, and the URL says the true thing
 * (`?repo=ally-be,ally-web`).
 *
 * Status and roadmap stage stopped being facets on 2026-10-13: the tabs cover
 * status, and stage is derived from status.
 *
 * Kept out of the component for the ordinary reason: this is the part with
 * rules in it, and rules are worth testing without rendering a table.
 */

/** One tab, or every tab — the latter only for counting what each tab would hold. */
export type BucketFilter = LifecycleBucket | "all";

/**
 * Every column the table shows is sortable: the bug's title, its status (in
 * lifecycle order) and its age. Severity, repo, stage, cost and "updated" lost
 * their columns on 2026-10-13 and their sort keys with them — a `?sort=` for a
 * column that is not on screen orders the rows by something the reader cannot
 * see, which reads as a broken table. An old link carrying one falls back to
 * the default order.
 */
export type SortKey = "discovered" | "title" | "status";

export const SORT_KEYS: SortKey[] = ["discovered", "title", "status"];

export type SortDirection = "asc" | "desc";

/**
 * The direction a column is usually read in, used when the reader switches to
 * a new sort key rather than flipping the current one: newest first for age,
 * A–Z for a title, and "most in need of a human first" for status.
 */
export const DEFAULT_SORT_DIRECTION: Record<SortKey, SortDirection> = {
  discovered: "desc",
  title: "asc",
  status: "asc",
};

/** High first — the order an admin means by "worst first". */
const SEVERITY_RANK: Record<BugFindingSeverity, number> = {
  [BugFindingSeverity.HIGH]: 3,
  [BugFindingSeverity.MEDIUM]: 2,
  [BugFindingSeverity.LOW]: 1,
};

/**
 * Where a status sorts, when the reader asks for the Status column.
 *
 * Tab order first, status order within the tab — never the enum's own
 * declaration order and never alphabetical. Within one tab that groups like
 * with like: in Done, the merged fixes, then the live ones, then the closed.
 *
 * Derived from `LIFECYCLE_BUCKETS` rather than written out, so the two orders
 * cannot drift and an eighteenth status is classified in exactly one place
 * (`bucketOfStatus`).
 */
const STATUS_RANK: Record<BugFindingStatus, number> = Object.values(BugFindingStatus).reduce(
  (ranks, status) => {
    const bucketIndex = LIFECYCLE_BUCKETS.indexOf(bucketOfStatus(status));
    // ×100 leaves room for the within-tab tiebreak below without any tab's
    // range ever reaching into the next one's.
    ranks[status] = bucketIndex * 100 + Object.values(BugFindingStatus).indexOf(status);
    return ranks;
  },
  {} as Record<BugFindingStatus, number>,
);

/**
 * How old a bug is, as a filter.
 *
 * The two "over" bands are deliberately `STALENESS_DAYS` and not round numbers
 * of their own, so the filter and the Age column's tint on Needs-you rows agree
 * about what "over a week" means.
 */
export type AgeFilter = "all" | "day" | "week" | "stale" | "ancient";

export const AGE_FILTERS: AgeFilter[] = ["all", "day", "week", "stale", "ancient"];

const matchesAge = (finding: BugFinding, age: AgeFilter, now: number): boolean => {
  if (age === "all") return true;
  const days = ageInDays(finding, now);
  if (days == null) return false;
  switch (age) {
    case "day":
      return days < 1;
    case "week":
      return days < STALENESS_DAYS.stale;
    case "stale":
      return days >= STALENESS_DAYS.stale;
    case "ancient":
      return days >= STALENESS_DAYS.ancient;
  }
};

export interface FindingsFilters {
  /** The open tab. Navigation rather than a filter in the reader's sense, but applied the same way. */
  bucket: BucketFilter;
  /** Free text over title, description, file, repo and the reporter's name. Trimmed and case-folded by `applyFilters`. */
  search: string;
  /** Empty means "every repo" — same for every array below. */
  repos: string[];
  severities: BugFindingSeverity[];
  sources: BugFindingSource[];
  age: AgeFilter;
  /**
   * Narrow to bugs that share a duplicate key with at least one other bug in
   * the window. A filter over the window rather than a facet, because
   * duplicate-ness is a property of the *set*, not of a row.
   */
  duplicatesOnly: boolean;
}

export const EMPTY_FILTERS: FindingsFilters = {
  bucket: "all",
  search: "",
  repos: [],
  severities: [],
  sources: [],
  age: "all",
  duplicatesOnly: false,
};

/** How many facet values are set — the "Filters" button's badge, and whether the pill row has anything to show. Tab and search are excluded: they have their own always-visible controls. */
export const activeFacetCount = (filters: FindingsFilters): number =>
  filters.repos.length +
  filters.severities.length +
  filters.sources.length +
  (filters.age === "all" ? 0 : 1) +
  (filters.duplicatesOnly ? 1 : 0);

/**
 * Whether search or a facet is narrowing the rows. The tab is not counted: it
 * is where the reader is, not a filter they forgot they set, and "Clear
 * filters" leaves it alone.
 */
export const hasActiveFilters = (filters: FindingsFilters): boolean =>
  filters.search.trim() !== "" || activeFacetCount(filters) > 0;

/**
 * Joins the parts of a duplicate key.
 *
 * A NUL, because it is the one character a free-text bug title cannot contain —
 * so "a" + "bc" can never collide with "ab" + "c". Written as an escape rather
 * than as the byte itself: a raw NUL in the source makes git classify this
 * `.ts` file as binary, which costs the diff, the review and `grep -I`.
 */
const DUPLICATE_KEY_SEPARATOR = "\u0000";

/**
 * The key two findings have to share to be called duplicates of each other.
 *
 * Title, repo *and* status — not title alone. Two records with the same title
 * where one is REJECTED and the other is NEW are not the same item to an admin:
 * one is a decision already made and the other is a decision outstanding.
 */
export const duplicateKey = (finding: BugFinding): string =>
  [finding.title.trim().toLowerCase(), finding.repo ?? "", finding.status].join(
    DUPLICATE_KEY_SEPARATOR,
  );

export interface FindingRow {
  finding: BugFinding;
  /**
   * How many findings in the window share this row's duplicate key, when that
   * is more than one. Undefined for the ordinary case.
   *
   * Duplicates are *flagged and both kept*, never collapsed into one row. The
   * same bug reported twice is two records, each independently approvable and
   * rejectable, and merging them behind a "×2" badge would leave the second one
   * live after someone had dealt with what looked like the only one.
   */
  duplicateCount?: number;
}

export interface FindingsView {
  /** The rows for the current page. */
  rows: FindingRow[];
  /** Findings matching the filters, across all pages. */
  matched: number;
  /** Every matching finding's id, in sorted order — what "select all N" ticks. */
  matchedIds: string[];
  /** Findings in the loaded window, before filtering. */
  loaded: number;
  /** Total findings the backend reports, which may exceed the window. */
  total: number;
  /** True when the backend has more findings than the window holds, so filters are known to be partial. */
  windowed: boolean;
  pageCount: number;
  /** Clamped into range, so a filter change that shrinks the list can never leave an empty page showing. */
  page: number;
}

export interface BuildFindingsViewInput {
  findings: BugFinding[];
  /** `count` from the list response — total in the table, not in the window. */
  total: number;
  filters: FindingsFilters;
  sortKey: SortKey;
  sortDirection: SortDirection;
  page: number;
  pageSize: number;
  /** Injectable clock, so the age facet is testable without freezing global time. */
  now?: number;
}

const matchesSearch = (finding: BugFinding, needle: string): boolean =>
  finding.title.toLowerCase().includes(needle) ||
  // Description is searched but never shown in the table. That asymmetry is
  // deliberate: a triager who remembers a phrase from a bug's body should find
  // the row, and rendering the body would cost the column that makes the table
  // scannable. The drawer is where the match is read.
  finding.description.toLowerCase().includes(needle) ||
  (finding.file?.toLowerCase().includes(needle) ?? false) ||
  (finding.repo?.toLowerCase().includes(needle) ?? false) ||
  // "Everything Priya filed" is a question this table shows the answer to on
  // every human-reported row.
  (finding.report?.reportedByName?.toLowerCase().includes(needle) ?? false);

/**
 * True when a value passes a multi-select facet.
 *
 * An empty array is "no opinion", never "match nothing" — which is what makes
 * an unset facet free rather than something every caller has to special-case.
 */
const passesFacet = <T>(selected: T[], value: T | null): boolean =>
  selected.length === 0 || (value !== null && selected.includes(value));

const applyFilters = (
  findings: BugFinding[],
  filters: FindingsFilters,
  duplicates: Map<string, number>,
  now: number,
): BugFinding[] => {
  const needle = filters.search.trim().toLowerCase();

  return findings.filter(finding => {
    if (filters.bucket !== "all" && bucketOf(finding) !== filters.bucket) return false;
    if (!passesFacet(filters.repos, finding.repo)) return false;
    if (!passesFacet(filters.severities, finding.severity)) return false;
    if (!passesFacet(filters.sources, finding.source)) return false;
    if (!matchesAge(finding, filters.age, now)) return false;
    if (filters.duplicatesOnly && (duplicates.get(duplicateKey(finding)) ?? 1) < 2) return false;
    if (needle !== "" && !matchesSearch(finding, needle)) return false;
    return true;
  });
};

const compare = (a: BugFinding, b: BugFinding, sortKey: SortKey): number => {
  switch (sortKey) {
    case "title":
      return a.title.localeCompare(b.title);
    case "discovered":
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    case "status":
      return STATUS_RANK[a.status] - STATUS_RANK[b.status];
  }
};

/**
 * Sorts a copy, never the argument.
 *
 * The array handed in is `data.items` straight off an RTK Query cache entry,
 * which the header reads from in the same render. `.sort()` mutates in place,
 * so sorting it directly would reorder the header's view of the world as a
 * side effect of clicking a column header here.
 */
const sortFindings = (
  findings: BugFinding[],
  sortKey: SortKey,
  direction: SortDirection,
): BugFinding[] => {
  const sign = direction === "asc" ? 1 : -1;
  return [...findings].sort((a, b) => {
    const primary = compare(a, b, sortKey) * sign;
    if (primary !== 0) return primary;
    // Ties broken by recency, then by id. Without the id, two findings created
    // in the same second swap places between polls and the table flickers.
    const byRecency = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    return byRecency !== 0 ? byRecency : a.id.localeCompare(b.id);
  });
};

/** Duplicate counts are computed over the whole loaded window, not the page — a pair split across a page boundary is still a pair. */
const countDuplicates = (findings: BugFinding[]): Map<string, number> => {
  const counts = new Map<string, number>();
  findings.forEach(finding => {
    const key = duplicateKey(finding);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return counts;
};

export const buildFindingsView = ({
  findings,
  total,
  filters,
  sortKey,
  sortDirection,
  page,
  pageSize,
  now = Date.now(),
}: BuildFindingsViewInput): FindingsView => {
  const duplicates = countDuplicates(findings);
  const matched = sortFindings(
    applyFilters(findings, filters, duplicates, now),
    sortKey,
    sortDirection,
  );

  const pageCount = Math.max(1, Math.ceil(matched.length / pageSize));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const start = safePage * pageSize;

  const rows: FindingRow[] = matched.slice(start, start + pageSize).map(finding => {
    const count = duplicates.get(duplicateKey(finding)) ?? 1;
    return count > 1 ? { finding, duplicateCount: count } : { finding };
  });

  return {
    rows,
    matched: matched.length,
    matchedIds: matched.map(finding => finding.id),
    loaded: findings.length,
    total,
    windowed: total > findings.length,
    pageCount,
    page: safePage,
  };
};

/**
 * How many bugs each tab would hold under the current search and facets.
 *
 * Narrowed by them, unlike the facet panel's own counts, because these are
 * what tell a searcher where their match went: a title typed on the Needs you
 * tab that lives in Done shows up as "Done 1" rather than as an empty table.
 */
export const countTabs = (
  findings: BugFinding[],
  filters: FindingsFilters,
  now: number = Date.now(),
): BucketCounts =>
  countByBucket(
    applyFilters(findings, { ...filters, bucket: "all" }, countDuplicates(findings), now),
  );

/** Repos present in the window, for the repo facet — so the facet never offers a value that matches nothing. */
export const reposInWindow = (findings: BugFinding[]): string[] =>
  Array.from(new Set(findings.map(finding => finding.repo).filter((r): r is string => !!r))).sort();

/**
 * Sources present in the window, alphabetically by enum value — offered
 * instead of every value the enum can hold, because a facet of mostly-empty
 * options has to be clicked to find out which ones do nothing.
 */
export const sourcesInWindow = (findings: BugFinding[]): BugFindingSource[] =>
  Array.from(new Set(findings.map(finding => finding.source))).sort();

/** Severities present in the window, worst first. Same argument as `sourcesInWindow`. */
export const severitiesInWindow = (findings: BugFinding[]): BugFindingSeverity[] =>
  Array.from(
    new Set(findings.map(finding => finding.severity).filter((s): s is BugFindingSeverity => !!s)),
  ).sort((a, b) => SEVERITY_RANK[b] - SEVERITY_RANK[a]);

/** How many bugs in the window share a duplicate key with another — the count on the "duplicates only" toggle. */
export const duplicateCountInWindow = (findings: BugFinding[]): number => {
  const counts = countDuplicates(findings);
  return findings.filter(finding => (counts.get(duplicateKey(finding)) ?? 1) > 1).length;
};

export interface FacetCounts {
  repos: Record<string, number>;
  severities: Record<string, number>;
  sources: Record<string, number>;
  ages: Record<AgeFilter, number>;
  duplicates: number;
}

/**
 * How many bugs in the window carry each facet value — the numbers beside the
 * checkboxes in the filter panel.
 *
 * Counted over the **whole loaded window**, not over the rows the other filters
 * currently leave standing: a panel where ticking "ally-be" silently rewrites
 * the numbers next to every other facet is a panel whose numbers cannot be
 * compared with each other.
 */
export const buildFacetCounts = (findings: BugFinding[], now: number = Date.now()): FacetCounts => {
  const counts: FacetCounts = {
    repos: {},
    severities: {},
    sources: {},
    ages: { all: findings.length, day: 0, week: 0, stale: 0, ancient: 0 },
    duplicates: duplicateCountInWindow(findings),
  };

  const bump = (map: Record<string, number>, key: string | null | undefined) => {
    if (key == null) return;
    map[key] = (map[key] ?? 0) + 1;
  };

  findings.forEach(finding => {
    bump(counts.repos, finding.repo);
    bump(counts.severities, finding.severity);
    bump(counts.sources, finding.source);
    // The bands overlap on purpose — "under a week" contains "under a day", and
    // "over a month" is a subset of "over a week" — because each is counted the
    // same way the filter matches, and a reader picking one wants the number
    // that filter will produce, not a share of a partition.
    (["day", "week", "stale", "ancient"] as const).forEach(band => {
      if (matchesAge(finding, band, now)) counts.ages[band] += 1;
    });
  });

  return counts;
};

/**
 * Whether Bug Hunter is moving this bug right now — the spinner rides along
 * wherever this is true. Asked of the shared `IN_FLIGHT_STATUSES` rather than a
 * copy, so the spinner, the header's "fixing N now" and the In progress tab
 * cannot disagree about what "working" means.
 */
export const isMidFlight = (status: BugFindingStatus): boolean =>
  IN_FLIGHT_STATUSES.includes(status);
