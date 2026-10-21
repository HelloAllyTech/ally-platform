import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { toast } from "sonner";

import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
} from "@ally-ui-mono/ui-shared";
import {
  useApproveBugFindingMutation,
  useGetBugFindingsQuery,
  useGetBugHuntRunQuery,
  useRejectBugFindingMutation,
  useStartBugFixSessionMutation,
} from "@api";
// Reached past the barrel on purpose. Importing the barrel pulls @constants,
// which reads `cellTypes` back off it at module-eval time — a test that needs
// the real boundary while stubbing the barrel deadlocks on that cycle. Same
// direct-path treatment as @components/action-confirmation-popup elsewhere.
import { TooltipIcon } from "@assets";
import { EmptyState } from "@components";
import { ActionConfirmationPopup } from "@components/action-confirmation-popup";
import { ErrorBoundary } from "@components/error-boundary";
import { en } from "@constants";
import {
  BUG_FINDING_LOW_CONFIDENCE_THRESHOLD,
  BugFinding,
  BugFindingDecisionReason,
  BugFindingSeverity,
} from "@types";
import { formatDateTime, formatTimestamp } from "@utils";

import { BrailleSpinner } from "./BrailleSpinner";
import { BugFindingDrawer } from "./BugFindingDrawer";
import { BUG_FINDING_SEVERITY_LABELS, BUG_FINDING_SOURCE_LABELS } from "./bugFindingLabels";
import { BugFindingStatusBadge } from "./BugFindingStatusBadge";
import { PAGE_SIZES, PageSize, useBugHunterUrlState } from "./bugHunterUrlState";
import { BulkTriageBar } from "./BulkTriageBar";
import { canSubmitDecline, DeclineReasonPicker } from "./DeclineReasonPicker";
import { FindingsFilterBar } from "./FindingsFilterBar";
import { BUG_FINDINGS_TABLE_ANCHOR_ID } from "./findingsTableAnchor";
import { FindingsTabs } from "./FindingsTabs";
import {
  buildFacetCounts,
  buildFindingsView,
  countTabs,
  FindingsFilters,
  hasActiveFilters,
  isMidFlight,
  reposInWindow,
  severitiesInWindow,
  SortDirection,
  SortKey,
  sourcesInWindow,
} from "./findingsView";
import { countByBucket, defaultBucket, LifecycleBucket } from "./lifecycleBucket";
import {
  ageInDays,
  canAct,
  formatAge,
  NextStep,
  nextStep,
  showsStaleness,
  stalenessTier,
  TriageAction,
} from "./triage";

/**
 * The Staff/Consumer badge on a human-filed bug.
 *
 * Purple, matching the roadmap board's own consumer badge — the same distinction
 * carried over from the screen that used to make it, so someone who knows one
 * recognises the other. Both values get a badge here, unlike on the roadmap where
 * "staff" was the silent default: on that board almost everything was staff-filed,
 * whereas here almost nothing is human-filed at all, so which KIND of person filed
 * it is the informative half.
 */
const CONSUMER_BADGE_STYLE =
  "inline-flex items-center rounded bg-purple-50 px-1 text-xs font-semibold text-purple-700";

/**
 * The severity dot before a title — what is left of the Severity column.
 *
 * Red for high, two greys below it. No amber: amber no longer means anything on
 * this page, and a medium-severity bug is not a warning. The word is in the
 * dot's accessible name and hover title, and the facet is how you filter by it.
 */
const SEVERITY_DOTS: Record<BugFindingSeverity, string> = {
  [BugFindingSeverity.HIGH]: "bg-destructive-500",
  [BugFindingSeverity.MEDIUM]: "bg-neutral-500",
  [BugFindingSeverity.LOW]: "bg-neutral-300",
};

/**
 * Sticks the header to the top of the page's scroll container.
 *
 * On a `<th>` rather than on the `<tr>`, because `position: sticky` on a table
 * row is ignored by Safari and by older Chrome — the cells are what stick. The
 * opaque background is not optional: without it, rows scroll visibly *through*
 * the header text.
 */
const STICKY_HEADER = "sticky top-0 z-20 bg-neutral-50";

/**
 * Age tint. Only ever applied to bugs waiting on you — see `showsStaleness` —
 * and in the needs-you orange rather than amber and red: a decision you have
 * owed for a month is late, not failed.
 */
const STALENESS_STYLES = {
  fresh: "text-typography-700",
  recent: "text-typography-700",
  stale: "text-orange-700 font-medium",
  ancient: "text-orange-700 font-semibold",
} as const;

/**
 * How many of the newest bugs load on first render, and how many more each
 * "Load more" click asks the server for.
 *
 * `GET /findings` does real server-side `limit`/`offset` paging with an
 * honest `count`, but this table and the page header ask for the identical
 * `{status: "all", limit: 100}` so they share one RTK Query cache entry rather
 * than each opening its own request (see `findingsView.ts`'s module doc). Growing this table's own `limit` on demand
 * is the same trade its `run` scope already makes: one shared request in the
 * ordinary case, and a second cache entry only once a reader does something —
 * scoping to a run, or now clicking "Load more" — that specifically calls for
 * more than the shared window holds.
 */
const FINDINGS_BASE_LIMIT = 100;
const FINDINGS_LOAD_INCREMENT = 100;

/**
 * A checkbox that can render the third state.
 *
 * Same shape as `NotionTable`'s: `indeterminate` is a DOM property with no HTML
 * attribute, so it can only be set through a ref. A header checkbox for a
 * partial selection has to show it — a plain unchecked box next to twelve
 * selected rows reads as "nothing is selected".
 */
const TriStateCheckbox: FC<{
  id: string;
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}> = ({ id, checked, indeterminate = false, onChange, label, disabled }) => {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);

  return (
    <input
      ref={ref}
      id={id}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onChange={onChange}
      // Stops a click on the box from also opening the row underneath it.
      onClick={event => event.stopPropagation()}
      className="w-4 h-4 text-black border-border-light rounded focus:ring-black cursor-pointer disabled:cursor-not-allowed"
    />
  );
};

const SortableHeader: FC<{
  sortKey: SortKey;
  label: string;
  activeKey: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
  className?: string;
  /**
   * Help text for a column whose name does not fully explain it.
   *
   * Rendered as a sibling of the sort button, never inside it: a tooltip
   * trigger is itself a `<button>`, and nesting one inside the sort control
   * would be invalid markup and would sort the table on the way to reading the
   * explanation.
   */
  tooltip?: string;
}> = ({ sortKey, label, activeKey, direction, onSort, className, tooltip }) => {
  const isActive = activeKey === sortKey;
  return (
    <TableHeader
      className={`py-2.5 pr-3 font-medium ${STICKY_HEADER} ${className ?? ""}`}
      // Real `aria-sort` on the header cell rather than a visual caret only:
      // the old table had no sort at all, and adding one that a screen reader
      // cannot read the state of would be adding half of it.
      aria-sort={isActive ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className="inline-flex items-center gap-1 cursor-pointer hover:text-typography-900"
        >
          {label}
          {/* The inactive marker is deliberately faint rather than absent:
              every column here sorts now, and a caret that appears only on the
              active one leaves a reader guessing which of the others will
              respond to a click. */}
          <span
            aria-hidden="true"
            className={`text-xs ${isActive ? "text-typography-700" : "text-typography-300"}`}
          >
            {isActive ? (direction === "asc" ? "▲" : "▼") : "↕"}
          </span>
        </button>
        {tooltip && (
          // `autoAlign` is on by default in the shared wrapper, which matters
          // here specifically: this header is `position: sticky` at the top of
          // the page's scroll container, so a top-aligned tooltip would open
          // into the chrome above it and flips itself instead.
          <Tooltip label={tooltip} align="top">
            <button type="button" className="cursor-pointer inline-flex items-center">
              <TooltipIcon />
            </button>
          </Tooltip>
        )}
      </span>
    </TableHeader>
  );
};

/**
 * The row's one button: the next thing a person does on this bug.
 *
 * One look for all five verbs — bordered, 28px, primary-tinted — so the column
 * reads as "these rows want you" rather than as a legend of colours to learn.
 * Reject and "Put me on it" left the row on 2026-10-13: both are in the drawer
 * and the bulk bar, and keyboard `r` and `f` still reach them from the row.
 */
const NextStepButton: FC<{ onClick: () => void; children: string }> = ({ onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex h-9 items-center whitespace-nowrap rounded-md border border-primary-200 bg-white px-2.5 text-xs font-medium text-primary-700 md:h-7 cursor-pointer transition-colors hover:bg-primary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
  >
    {children}
  </button>
);

/** Read inside a function — see `bucketLabels` in FindingsTabs on why not at module scope. */
const nextStepLabels = (): Record<NextStep, string> => ({
  approve: en.bugHunter.nextStepApprove,
  answer: en.bugHunter.nextStepAnswer,
  retry: en.bugHunter.nextStepRetry,
  merge: en.bugHunter.nextStepMerge,
  release: en.bugHunter.nextStepRelease,
});

/** What an empty tab says — where things in it come from, so an empty tab reads as "nothing yet", not "broken". */
const tabEmptyCopy = (): Record<LifecycleBucket, { title: string; subtitle: string }> => ({
  needs_you: {
    title: en.bugHunter.tabEmptyNeedsYouTitle,
    subtitle: en.bugHunter.tabEmptyNeedsYouSubtitle,
  },
  failed: {
    title: en.bugHunter.tabEmptyFailedTitle,
    subtitle: en.bugHunter.tabEmptyFailedSubtitle,
  },
  in_progress: {
    title: en.bugHunter.tabEmptyInProgressTitle,
    subtitle: en.bugHunter.tabEmptyInProgressSubtitle,
  },
  backlog: {
    title: en.bugHunter.tabEmptyBacklogTitle,
    subtitle: en.bugHunter.tabEmptyBacklogSubtitle,
  },
  done: { title: en.bugHunter.tabEmptyDoneTitle, subtitle: en.bugHunter.tabEmptyDoneSubtitle },
});

/** The id of the region the tabs control. */
const FINDINGS_PANEL_ID = "bug-findings-panel";

/** How many page buttons the pager shows before it starts eliding the middle. */
const PAGER_MAX_VISIBLE = 7;

/**
 * Which page numbers (zero-based) to show, with `null` where a run of pages
 * is elided. Always the first and last page, and the current page with one
 * neighbour each side, so the reader can see where they are and jump to
 * either end without a page-size calculation.
 */
export const pagerItems = (page: number, pageCount: number): (number | null)[] => {
  if (pageCount <= PAGER_MAX_VISIBLE) {
    return Array.from({ length: pageCount }, (_, index) => index);
  }
  const last = pageCount - 1;
  if (page <= 3) return [0, 1, 2, 3, 4, null, last];
  if (page >= last - 3) return [0, null, last - 4, last - 3, last - 2, last - 1, last];
  return [0, null, page - 1, page, page + 1, null, last];
};

const PAGER_BUTTON =
  "inline-flex h-10 min-w-10 items-center justify-center rounded-md border px-2 text-xs font-medium tabular-nums cursor-pointer md:h-8 md:min-w-8 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:cursor-not-allowed disabled:opacity-40";
const PAGER_BUTTON_IDLE =
  "border-border-light bg-white text-typography-800 hover:bg-neutral-50 hover:border-border-medium";
const PAGER_BUTTON_ACTIVE = "border-primary-500 bg-primary-500 text-white";

/**
 * Previous / numbered pages / Next.
 *
 * Replaces two Carbon ghost buttons either side of "Page 1 of 5": ghost
 * buttons have no border and the disabled one greys to the colour of the
 * caption beside it, so the whole footer read as three words of muted text
 * and nothing in it looked pressable. Numbered pages also make "jump to the
 * end" one click, which a Next button alone never can.
 */
const TablePager: FC<{
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
}> = ({ page, pageCount, onChange }) => (
  <nav
    className="flex flex-wrap items-center gap-1"
    aria-label={en.bugHunter.pageStatus
      .replace("{page}", String(page + 1))
      .replace("{pages}", String(pageCount))}
  >
    <button
      type="button"
      className={`${PAGER_BUTTON} ${PAGER_BUTTON_IDLE} gap-1`}
      disabled={page === 0}
      onClick={() => onChange(Math.max(0, page - 1))}
    >
      <span aria-hidden="true">‹</span>
      {en.bugHunter.pagePrev}
    </button>
    {pagerItems(page, pageCount).map((item, index) =>
      item === null ? (
        <span
          key={`gap-${index}`}
          aria-hidden="true"
          className="inline-flex h-10 w-6 items-center justify-center text-xs text-typography-500 md:h-8"
        >
          …
        </span>
      ) : (
        <button
          key={item}
          type="button"
          aria-current={item === page ? "page" : undefined}
          aria-label={en.bugHunter.pageStatus
            .replace("{page}", String(item + 1))
            .replace("{pages}", String(pageCount))}
          className={`${PAGER_BUTTON} ${item === page ? PAGER_BUTTON_ACTIVE : PAGER_BUTTON_IDLE}`}
          onClick={() => onChange(item)}
        >
          {item + 1}
        </button>
      ),
    )}
    <button
      type="button"
      className={`${PAGER_BUTTON} ${PAGER_BUTTON_IDLE} gap-1`}
      disabled={page >= pageCount - 1}
      onClick={() => onChange(page + 1)}
    >
      {en.bugHunter.pageNext}
      <span aria-hidden="true">›</span>
    </button>
  </nav>
);

/** Six pulsing rows, so a slow response looks like a table arriving rather than a broken page. */
const TableSkeleton: FC = () => (
  <div className="flex flex-col gap-2" aria-hidden="true">
    {Array.from({ length: 6 }).map((_, index) => (
      <div
        key={index}
        className="h-11 rounded bg-neutral-100 animate-pulse motion-reduce:animate-none"
      />
    ))}
  </div>
);

export interface BugFindingsTableProps {
  /** How many bugs to ask the server for on the first load. */
  initialLimit?: number;
  /** Opens the shortcut sheet. Owned by the page so `?` works from anywhere on it. */
  onShowShortcuts: () => void;
  /**
   * False for a SUPER_ADMIN, who can read this table but not act on it, and for
   * the roadmap's read-only Bugs tab — resolved once by the owning page and
   * threaded down here, into the row quick-actions, the keyboard shortcuts, the
   * bulk bar and the drawer, so there is exactly one copy of that rule.
   */
  canTriage: boolean;
}

/**
 * Every bug Bug Hunter knows about, from any source — pipeline findings and
 * human reports alike — as a surface built for triage rather than for reading.
 *
 * ## The 2026-10-13 simplification
 *
 * The product head found the page cluttered, and most of the clutter was one
 * fact shown several ways. This table took four cuts:
 *
 * - **Five tabs instead of eight chips** (`FindingsTabs`), opening on Needs you
 *   when it has anything in it and on In progress otherwise — never on
 *   "Everything", which on prod was 456 closed rows around 44 open ones.
 * - **Five columns instead of eleven**: the checkbox, the bug (a severity dot,
 *   the title, and one meta line of repo · source), Status, Age, and one
 *   action. Stage repeated Status in different words and disagreed with it for
 *   Merged, Releasing and Failed; Updated repeated Age; Repo and Source moved
 *   into the meta line; Est. cost and PR live in the drawer.
 * - **One button per row, only on rows that need a human** (`nextStep`). Three
 *   tinted buttons on every row made every row look like it needed you.
 * - **Four status colours** (`BugFindingStatusBadge`): orange needs you, red
 *   failed, green live, grey everything else. Agent-working is the spinner.
 *
 * The rest of what earlier rebuilds gave it stands: search and multi-select
 * facets behind one button, sortable columns with real `aria-sort`, the URL as
 * the source of truth, paging, a skeleton, duplicate flagging, the bulk bar,
 * and the keyboard cursor with its shortcuts.
 *
 * ## Which tab is open
 *
 * The link's `?bucket=` when it names one. Otherwise `defaultBucket` decides,
 * **once**, from the first counts that arrive, and the choice holds: if you
 * approve the last bug on Needs you, the tab stays put and says so, rather
 * than jumping to In progress under your cursor because the default moved.
 *
 * ## A failed poll does not empty the table
 *
 * `isError` used to win over `data`, and this list polls every fifteen seconds
 * — so one timed-out poll swapped the rows for a single line of error text,
 * and the next poll brought them back. Stale rows under a warning strip are
 * strictly better than no rows.
 */
export const BugFindingsTable: FC<BugFindingsTableProps> = ({
  onShowShortcuts,
  canTriage,
  initialLimit = FINDINGS_BASE_LIMIT,
}) => {
  const {
    bug: selectedId,
    bucket: linkedBucket,
    search,
    run,
    repos,
    severities,
    sources,
    age,
    duplicatesOnly,
    sort: sortKey,
    direction: sortDirection,
    pageSize,
    setBug,
    setBucket,
    setSearch,
    setRun,
    setRepos,
    setSeverities,
    setSources,
    setAge,
    setDuplicatesOnly,
    toggleSort,
    setPageSize,
    clearFilters,
  } = useBugHunterUrlState();

  const [page, setPage] = useState(0);

  /** How far "Load more" has grown the server-side window. Resets with the run scope, below. */
  const [limit, setLimit] = useState(initialLimit);
  /**
   * True only between a "Load more" click and the bigger window landing.
   *
   * Distinct from the query's own `isFetching`, which also flips true on the
   * silent 15-second poll — tying the button's label to that directly would
   * flash "Loading…" on every poll rather than only when a reader asked for
   * more.
   */
  const [loadingMore, setLoadingMore] = useState(false);

  /** Ids the reader has ticked. Kept as ids, not findings, so a poll that refreshes a row keeps it selected. */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /**
   * The bug the keyboard cursor is on, held as an **id rather than a row
   * index**.
   *
   * An index is the obvious choice and the wrong one: re-sort the table, change
   * a filter, or let a poll insert a newly-found bug above the cursor, and
   * index 4 is now a different bug than the one that was highlighted — with
   * `a` and `r` still aimed at it. An id either still exists on the page or it
   * does not, and "does not" is simply no cursor. It also means the cursor
   * follows its bug across a sort instead of staying put.
   */
  const [cursorId, setCursorId] = useState<string | null>(null);
  /** A single-row decision awaiting its confirmation. */
  /** The decline reason for a single-row reject, cleared once it settles. */
  const [declineReason, setDeclineReason] = useState<BugFindingDecisionReason | null>(null);
  const [declineNote, setDeclineNote] = useState("");
  const [pending, setPending] = useState<{ action: TriageAction; finding: BugFinding } | null>(
    null,
  );

  const [approve] = useApproveBugFindingMutation();
  const [reject] = useRejectBugFindingMutation();
  const [startFixSession] = useStartBugFixSessionMutation();

  /**
   * Unscoped, these are the same args as the page header's, so both read one
   * RTK Query cache entry rather than opening a request each, and every filter
   * below is applied to that shared window client-side (see findingsView.ts).
   *
   * A run scope is the one exception, and has to be: `runId` goes to the server
   * and *replaces* the window rather than filtering it. A sweep stamps its id
   * onto every row it touches — including a human-reported bug filed weeks ago,
   * which is the common case, not the corner one — so its findings are not the
   * newest hundred rows and filtering the shared window would have found only
   * the few that happened to be recent, then reported that number as the total.
   * That costs one extra cache entry while a scope is on, and is the difference
   * between "the 10 that sweep found" and "the 2 of them I could see".
   */
  const queryArgs = useMemo(
    () => (run ? { status: "all" as const, limit, runId: run } : { status: "all" as const, limit }),
    [run, limit],
  );

  const { data, currentData, isLoading, isFetching, isError, refetch } = useGetBugFindingsQuery(
    queryArgs,
    {
      pollingInterval: 15_000,
    },
  );

  // A new scope starts its own window fresh, rather than carrying over
  // however far a previous "Load more" run had grown it.
  useEffect(() => {
    setLimit(initialLimit);
  }, [run, initialLimit]);

  useEffect(() => {
    if (!isFetching) setLoadingMore(false);
  }, [isFetching]);

  const handleLoadMore = useCallback(() => {
    setLoadingMore(true);
    setLimit(current => (current ?? 0) + FINDINGS_LOAD_INCREMENT);
  }, []);

  /**
   * The scoped sweep, for the banner's own words.
   *
   * Skipped entirely when there is no scope — an admin who never clicks a count
   * in the shift log should not pay a request for a banner that never renders.
   * The shift log has usually already cached this entry by the time they do.
   */
  const { data: scopedRun } = useGetBugHuntRunQuery(run ?? "", { skip: !run });

  // Memoised because `data?.items ?? []` is a fresh array identity every render:
  // without it the view below (filter, sort, duplicate scan, page slice) would
  // recompute on any unrelated re-render, and no dependency array could say so
  // honestly.
  const findings = useMemo<BugFinding[]>(() => data?.items ?? [], [data]);

  /**
   * Whether the last request failed *and* left nothing on screen.
   *
   * The distinction is the whole fix: RTK Query keeps `data` from the last good
   * response while `isError` describes the current one, so on a fifteen-second
   * poll a single timeout used to swap a full table for one line of error text.
   * A stale table under a warning strip is the honest rendering — the rows were
   * true a moment ago, and the strip says so.
   */
  const hasNothingToShow = findings.length === 0;
  const isStale = isError && !hasNothingToShow;

  /**
   * The tab chosen for a link that names none: decided once, from the first
   * counts that arrive for this scope, and then held — see the component doc.
   * Read off `currentData` rather than `data`, which RTK Query keeps from the
   * previous scope while a new one loads and would decide the new scope's tab
   * from the old scope's rows.
   */
  const [pickedBucket, setPickedBucket] = useState<LifecycleBucket | null>(null);
  // `data` only when nothing is in flight: mid-fetch it may still be the
  // previous scope's.
  const settledData = currentData ?? (isFetching ? undefined : data);
  useEffect(() => {
    setPickedBucket(null);
  }, [run]);
  useEffect(() => {
    if (linkedBucket || pickedBucket || !settledData) return;
    setPickedBucket(defaultBucket(countByBucket(settledData.items), { scoped: !!run }));
  }, [linkedBucket, pickedBucket, settledData, run]);

  // Needs you while the first page is in flight — the tab most loads land on,
  // so the strip doesn't open on one tab and jump to another as data arrives.
  const bucket: LifecycleBucket = linkedBucket ?? pickedBucket ?? "needs_you";

  const filters = useMemo<FindingsFilters>(
    () => ({
      bucket,
      search,
      repos,
      severities,
      sources,
      age,
      duplicatesOnly,
    }),
    [bucket, search, repos, severities, sources, age, duplicatesOnly],
  );

  // A filter change can shrink the list below the current offset, which would
  // otherwise leave an empty page rendered with no rows and no explanation.
  // `buildFindingsView` clamps as a backstop; this resets the intent.
  useEffect(() => {
    setPage(0);
  }, [filters, sortKey, sortDirection, pageSize]);

  const view = useMemo(
    () =>
      buildFindingsView({
        findings,
        total: data?.count ?? findings.length,
        filters,
        sortKey,
        sortDirection,
        page,
        pageSize,
      }),
    [findings, data?.count, filters, sortKey, sortDirection, page, pageSize],
  );

  const tabCounts = useMemo(() => countTabs(findings, filters), [findings, filters]);
  const facetCounts = useMemo(() => buildFacetCounts(findings), [findings]);
  const available = useMemo(
    () => ({
      repos: reposInWindow(findings),
      severities: severitiesInWindow(findings),
      sources: sourcesInWindow(findings),
    }),
    [findings],
  );

  const rows = view.rows;

  /** Where the cursor's bug currently sits on this page, or -1 if it isn't on it. */
  const cursor = useMemo(
    () => (cursorId == null ? -1 : rows.findIndex(row => row.finding.id === cursorId)),
    [rows, cursorId],
  );

  /**
   * The selection, resolved against the loaded window.
   *
   * Every consumer reads *this* rather than `selectedIds`, which is what makes
   * a reconciliation pass unnecessary: rejecting twelve bugs drops them out of
   * the window, they stop appearing here, and the bar's count follows without
   * anything having to prune the id set in an effect. Ids for bugs that have
   * left the window linger in `selectedIds` and are simply inert — nothing
   * counts them, renders them or sends a request for them.
   */
  const selected = useMemo(
    () => findings.filter(finding => selectedIds.has(finding.id)),
    [findings, selectedIds],
  );

  // Which rows just showed up, so they can get a one-time fade-in — never on
  // the first successful load, only on a poll that grew the list. `null`
  // means "haven't seen a real response yet"; once set, it's the id set from
  // the previous render to diff the new one against.
  const seenIdsRef = useRef<Set<string> | null>(null);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());

  // from `data` and nothing else, so a new response is the only thing that can
  // change it; adding it would re-run this on identity churn instead.
  useEffect(() => {
    if (!data) return undefined;
    const currentIds = new Set(findings.map(finding => finding.id));
    if (seenIdsRef.current === null) {
      seenIdsRef.current = currentIds;
      return undefined;
    }
    const fresh = new Set<string>();
    currentIds.forEach(id => {
      if (!seenIdsRef.current!.has(id)) fresh.add(id);
    });
    seenIdsRef.current = currentIds;
    if (fresh.size === 0) return undefined;
    setFreshIds(fresh);
    const timer = setTimeout(() => setFreshIds(new Set()), 250);
    return () => clearTimeout(timer);
  }, [data]);

  const toggleId = useCallback((id: string) => {
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const pageIds = useMemo(() => rows.map(row => row.finding.id), [rows]);
  const allPageSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));
  const somePageSelected = pageIds.some(id => selectedIds.has(id));

  const togglePage = useCallback(() => {
    setSelectedIds(current => {
      const next = new Set(current);
      const everySelected = pageIds.length > 0 && pageIds.every(id => next.has(id));
      pageIds.forEach(id => (everySelected ? next.delete(id) : next.add(id)));
      return next;
    });
  }, [pageIds]);

  /**
   * Ticks every bug the current filters match, across every page.
   *
   * The header checkbox deliberately stays page-scoped. A checkbox in a column
   * header means "this column", and letting it silently reach rows nobody has
   * seen is how somebody bulk-rejects forty bugs they meant to skim. So the
   * cross-page version is a separate, named action that states the number it is
   * about to select, and it appears only when there is more than one page for
   * it to reach.
   */
  const selectAllMatching = useCallback(() => {
    setSelectedIds(new Set(view.matchedIds));
  }, [view.matchedIds]);

  const matchedAllSelected =
    view.matchedIds.length > 0 && view.matchedIds.every(id => selectedIds.has(id));

  /** Runs a single-row decision once its confirmation is accepted. */
  const runPending = async () => {
    if (!pending) return;
    const { action, finding } = pending;
    if (action === "reject" && !canSubmitDecline(declineReason, declineNote)) {
      toast.error(en.bugHunter.declineReasonRequired);
      return;
    }
    setPending(null);
    try {
      if (action === "approve") await approve(finding.id).unwrap();
      else if (action === "reject") {
        await reject({
          id: finding.id,
          reason: declineReason as BugFindingDecisionReason,
          note: declineNote,
        }).unwrap();
        setDeclineReason(null);
        setDeclineNote("");
      }
      // A bug with no repo opens the drawer instead of starting blind: the
      // drawer's dialog has the codebase picker, and a classifier that could
      // not place the bug at intake will not place it now either.
      else if (!finding.repo) setBug(finding.id);
      else await startFixSession({ id: finding.id }).unwrap();
    } catch {
      toast.error(en.bugHunter.quickActionFailed);
    }
  };

  /**
   * The row's one button. Approve and Try again confirm in place, through the
   * same dialog `a` and `f` raise; Answer, Merge and Release open the drawer,
   * which is where the answer box, the merge dialog's case chain and the
   * release target live.
   */
  const onNextStep = (step: NextStep, finding: BugFinding) => {
    if (step === "approve") setPending({ action: "approve", finding });
    else if (step === "retry") setPending({ action: "fix", finding });
    else setBug(finding.id);
  };

  // ── Keyboard ────────────────────────────────────────────────────
  const rowButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const searchRef = useRef<HTMLDivElement>(null);

  /**
   * Moves the cursor and puts real focus on that row's own control.
   *
   * Focus, not an `aria-activedescendant` shadow: the row's title button is
   * already a named control, so focusing it makes a screen reader announce the
   * row the cursor lands on and makes the browser scroll it into view — both
   * for free, and both correct in a way a hand-rolled cursor is not.
   */
  const moveCursor = useCallback(
    (delta: number) => {
      if (rows.length === 0) return;
      // From nothing, `j` starts at the top and `k` at the bottom, rather than
      // both starting at row one.
      const next = cursor < 0 ? (delta > 0 ? 0 : rows.length - 1) : cursor + delta;
      const clamped = Math.min(rows.length - 1, Math.max(0, next));
      setCursorId(rows[clamped].finding.id);
      const target = rowButtonRefs.current[clamped];
      target?.focus();
      // `nearest` rather than `center`: a row already fully visible should not
      // make the page jump, which is what `center` does on every keypress.
      target?.scrollIntoView({ block: "nearest" });
    },
    [cursor, rows],
  );

  const cursorFinding = cursor >= 0 ? rows[cursor].finding : null;

  /** Offers a decision for the row the cursor is on, or says why it doesn't apply. */
  const requestFromCursor = useCallback(
    (action: TriageAction) => {
      if (!canTriage) return;
      if (!cursorFinding) return;
      if (!canAct(action, cursorFinding)) {
        toast.error(en.bugHunter.quickActionNotApplicable);
        return;
      }
      setPending({ action, finding: cursorFinding });
    },
    [cursorFinding, canTriage],
  );

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      // Ctrl/Cmd/Alt combinations belong to the browser and the OS. Shift is
      // allowed through, because shift+X is one of ours.
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      // Never steal a keystroke from something the reader is typing into. `/`
      // in a search box has to be a slash, and `r` in one has to be an r.
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable === true
      ) {
        return;
      }
      // The drawer is a modal surface with its own controls; while it is open
      // the list underneath is not what the keyboard is addressing. Nor while
      // any other modal is — the help panel, a confirmation — where `a` would
      // otherwise approve the row under a cursor the reader can't see.
      if (selectedId) return;
      if (target?.closest?.('[aria-modal="true"]')) return;

      switch (event.key) {
        case "j":
        case "ArrowDown":
          event.preventDefault();
          moveCursor(1);
          return;
        case "k":
        case "ArrowUp":
          event.preventDefault();
          moveCursor(-1);
          return;
        case "o":
          if (cursorFinding) {
            event.preventDefault();
            setBug(cursorFinding.id);
          }
          return;
        case "a":
          event.preventDefault();
          requestFromCursor("approve");
          return;
        case "r":
          event.preventDefault();
          requestFromCursor("reject");
          return;
        case "f":
          event.preventDefault();
          requestFromCursor("fix");
          return;
        // Both spellings, and `shiftKey` rather than the capital, on purpose.
        // A real browser reports shift+x as `key: "X"`, but synthesised events
        // (automation, some IMEs, some remote-desktop layers) deliver `"x"`
        // with `shiftKey` set — and reading only the capital there turns
        // "select the page" into "deselect the row you were on", which is the
        // opposite of what was asked for.
        case "x":
        case "X":
          if (!canTriage) return;
          event.preventDefault();
          if (event.shiftKey) togglePage();
          else if (cursorFinding) toggleId(cursorFinding.id);
          return;
        // `?` is shift+/ on a US layout, and a real browser reports it as `"?"`.
        // Synthesised events report `"/"` with `shiftKey` instead — the same
        // split as shift+x above — so both spellings are accepted, and the
        // shifted form must be tested first or it falls through to "focus the
        // search box".
        case "/":
        case "?":
          event.preventDefault();
          if (event.key === "?" || event.shiftKey) onShowShortcuts();
          else searchRef.current?.querySelector("input")?.focus();
          return;
        case "Escape":
          if (selectedIds.size > 0) {
            event.preventDefault();
            setSelectedIds(new Set());
          }
          return;
        default:
          return;
      }
    };

    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [
    canTriage,
    cursorFinding,
    moveCursor,
    onShowShortcuts,
    requestFromCursor,
    selectedId,
    selectedIds.size,
    setBug,
    toggleId,
    togglePage,
  ]);

  // One row height. The comfortable/compact toggle came off the toolbar on
  // 2026-10-01 along with the "Keyboard" button; compact is what everyone had
  // switched to, and `?` still opens the shortcut sheet.
  const rowPadding = "py-2";

  const labels = nextStepLabels();
  const emptyCopy = tabEmptyCopy()[bucket];

  return (
    <div id={BUG_FINDINGS_TABLE_ANCHOR_ID} className="scroll-mt-4">
      {/* Above the tabs on purpose: the scope changes what every count below
          it counts, so a reader who has not seen this line will read
          "Backlog 7" as "seven bugs are waiting". Stacks' *Making Agent
          Trustworthiness Visible Through Transparency* is the argument for
          spelling out the audit trail rather than quietly narrowing the view. */}
      {run && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded border border-primary-200 bg-primary-50 px-3 py-2">
          <p className="text-xs text-typography-800">
            <span className="font-semibold">
              {scopedRun
                ? en.bugHunter.runScopeBanner
                    .replace("{repo}", scopedRun.repo)
                    .replace("{timestamp}", formatDateTime(scopedRun.createdAt))
                : en.bugHunter.runScopeBannerLoading}
            </span>{" "}
            {en.bugHunter.runScopeBannerHint}
          </p>
          <Button size="sm" kind="ghost" onClick={() => setRun(null)}>
            {en.bugHunter.runScopeClear}
          </Button>
        </div>
      )}

      <FindingsTabs
        counts={tabCounts}
        value={bucket}
        onChange={setBucket}
        panelId={FINDINGS_PANEL_ID}
        disabled={isLoading}
      />

      <div
        id={FINDINGS_PANEL_ID}
        role="tabpanel"
        aria-labelledby={`bug-findings-tab-${bucket}`}
        className="pt-3"
      >
        <div className="mb-3">
          <FindingsFilterBar
            filters={filters}
            available={available}
            counts={facetCounts}
            onSearch={setSearch}
            onRepos={setRepos}
            onSeverities={setSeverities}
            onSources={setSources}
            onAge={setAge}
            onDuplicatesOnly={setDuplicatesOnly}
            onClearAll={clearFilters}
            searchRef={searchRef}
          />
        </div>

        {/* A poll that failed while rows are already on screen. Deliberately a
            strip above the table rather than a replacement for it. */}
        {isStale && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded border border-border-light bg-neutral-50 px-3 py-2">
            <p className="text-xs text-typography-800">{en.bugHunter.findingsStaleNotice}</p>
            <Button size="sm" kind="ghost" onClick={() => refetch()}>
              {en.bugHunter.retry}
            </Button>
          </div>
        )}

        {isLoading ? (
          <TableSkeleton />
        ) : isError && hasNothingToShow ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-destructive-600 text-sm">{en.bugHunter.findingsLoadFailed}</p>
            <button
              type="button"
              onClick={() => refetch()}
              className="text-sm text-primary-600 underline"
            >
              {en.bugHunter.retry}
            </button>
          </div>
        ) : hasNothingToShow ? (
          <EmptyState
            title={en.bugHunter.findingsEmptyTitle}
            subtitle={en.bugHunter.findingsEmptySubtitle}
            hideActionButton
          />
        ) : view.matched === 0 && hasActiveFilters(filters) ? (
          // Filtered to nothing is a different situation from an empty tab:
          // telling someone "nothing needs you" when they have typed a typo
          // into the search box blames the page's state for the reader's.
          <div className="border border-border-light rounded-lg py-10 text-center">
            <p className="text-sm font-medium text-typography-900">{en.bugHunter.noMatchTitle}</p>
            <p className="text-xs text-typography-600 mt-1">{en.bugHunter.noMatchSubtitle}</p>
            <div className="mt-3">
              <Button size="sm" kind="tertiary" onClick={clearFilters}>
                {en.bugHunter.clearFilters}
              </Button>
            </div>
          </div>
        ) : view.matched === 0 ? (
          // An empty tab says what lands in it, so "nothing here" reads as
          // nothing yet rather than as something broken — and the counts on
          // the tabs above are the way on (Stacks: *The Four-Second Rule:
          // Confusion Triggers Disengagement*).
          <div
            className="border border-border-light rounded-lg py-10 text-center"
            data-testid="bug-findings-tab-empty"
          >
            <p className="text-sm font-medium text-typography-900">{emptyCopy.title}</p>
            <p className="text-xs text-typography-600 mt-1">{emptyCopy.subtitle}</p>
          </div>
        ) : (
          <>
            {/* Offered only when the selection could reach past this page. On a
                single-page result the header checkbox already selects everything,
                and a second control saying so would be two ways to do one job. */}
            {canTriage && somePageSelected && view.pageCount > 1 && !matchedAllSelected && (
              <div className="mb-2 rounded border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs text-typography-800">
                {en.bugHunter.selectAllMatchingPrompt.replace(
                  "{count}",
                  String(view.matchedIds.length),
                )}{" "}
                <button
                  type="button"
                  onClick={selectAllMatching}
                  className="font-semibold text-primary-700 underline cursor-pointer"
                >
                  {en.bugHunter.selectAllMatchingAction.replace(
                    "{count}",
                    String(view.matchedIds.length),
                  )}
                </button>
              </div>
            )}

            {/* One card around the rows and the pager. A wrapper rather than a
                border on the table itself, because `border-collapse` cannot
                round a corner — and deliberately without `overflow-hidden`,
                which would make this box the scrollport and stop the sticky
                header sticking to the page. */}
            <div className="rounded-lg border border-border-light bg-white">
              <Table className="w-full text-left border-collapse">
                <TableHead>
                  <TableRow className="border-b border-border-medium text-xs font-semibold text-typography-700">
                    {/* No selection column at all for a reader who cannot act —
                      bulk triage is a decision, gated like the row button and
                      the drawer's. The whole <TableHeader> goes, not just the
                      checkbox, or an empty gutter runs down every row. */}
                    {canTriage && (
                      <TableHeader className={`py-2.5 pl-3 pr-3 w-8 ${STICKY_HEADER}`}>
                        <Tooltip label={en.bugHunter.selectAllTooltip} align="right">
                          <span className="inline-flex">
                            <TriStateCheckbox
                              id="bug-findings-select-all"
                              checked={allPageSelected}
                              indeterminate={somePageSelected}
                              onChange={togglePage}
                              label={en.bugHunter.selectAllLabel}
                            />
                          </span>
                        </Tooltip>
                      </TableHeader>
                    )}
                    {/* The one column that holds prose, and the one that absorbs
                      whatever width the others leave. `w-full` here and
                      `max-w-0` on the body cell are a pair: without the second
                      the column grows to its content and the table leaves its
                      container — see the body cell. */}
                    <SortableHeader
                      sortKey="title"
                      label={en.bugHunter.findingColumnTitle}
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={toggleSort}
                      className={`w-full ${canTriage ? "" : "pl-3"}`}
                    />
                    <SortableHeader
                      sortKey="status"
                      label={en.bugHunter.findingColumnStatus}
                      tooltip={en.bugHunter.findingColumnStatusTooltip}
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={toggleSort}
                      className="whitespace-nowrap"
                    />
                    {/* The magnitude is what a triager reads ("this has been
                      sitting three weeks"); the exact timestamp is a hover away. */}
                    <SortableHeader
                      sortKey="discovered"
                      label={en.bugHunter.findingColumnAge}
                      tooltip={en.bugHunter.findingColumnAgeTooltip}
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={toggleSort}
                      className="whitespace-nowrap"
                    />
                    {/* Named for screen readers only: most rows have no button,
                      and a visible heading over an empty column promises
                      buttons that are not there. Same gate as the selection
                      column — a read-only reader gets no column at all. */}
                    {canTriage && (
                      <TableHeader
                        className={`py-2.5 pr-3 font-medium whitespace-nowrap ${STICKY_HEADER}`}
                      >
                        <span className="sr-only">{en.bugHunter.quickActionsColumn}</span>
                      </TableHeader>
                    )}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map(({ finding, duplicateCount }, index) => {
                    const days = ageInDays(finding);
                    const tier = days == null ? "fresh" : stalenessTier(days);
                    const tinted = showsStaleness(finding) ? tier : "fresh";
                    const isCursor = index === cursor;
                    const isSelected = selectedIds.has(finding.id);
                    const step = canTriage ? nextStep(finding) : null;

                    return (
                      <TableRow
                        key={finding.id}
                        className={`border-b border-border-light text-sm text-typography-900 cursor-pointer ${
                          isSelected ? "bg-primary-50" : "hover:bg-neutral-50"
                        } ${
                          // The keyboard cursor's own mark: a left rule on the
                          // row, so "where am I" is answerable at a glance while
                          // paging with j/k.
                          isCursor ? "shadow-[inset_3px_0_0_0_var(--cds-interactive,#0f62fe)]" : ""
                        } ${freshIds.has(finding.id) ? "animate-fadeIn motion-reduce:animate-none" : ""}`}
                        // Mouse convenience only. The row deliberately carries no
                        // role or tabIndex — see the button in the title cell.
                        onClick={() => setBug(finding.id)}
                      >
                        {/* Gated with its header above, never independently — a
                          body cell that outlives its column shifts every other
                          cell on the row one place left. */}
                        {canTriage && (
                          <TableCell className={`${rowPadding} pl-3 pr-3`}>
                            <TriStateCheckbox
                              id={`bug-finding-select-${finding.id}`}
                              checked={isSelected}
                              onChange={() => toggleId(finding.id)}
                              label={en.bugHunter.rowSelectLabel.replace("{title}", finding.title)}
                            />
                          </TableCell>
                        )}

                        {/* `max-w-0` is load-bearing, not a typo. A table cell's
                          column can never be narrower than its content's
                          min-content width, and `truncate` does not lower that —
                          so a long title would widen the column and push the
                          table past its container. `max-width: 0` opts this
                          column out of that floor: the header's `w-full` then
                          gets it the leftover space, and `truncate` does the
                          rest. */}
                        <TableCell
                          className={`${rowPadding} ${canTriage ? "" : "pl-3"} pr-4 min-w-[14rem] max-w-0`}
                        >
                          <div className="flex items-center gap-2">
                            {finding.severity && (
                              <span
                                role="img"
                                aria-label={en.bugHunter.severityDotLabel.replace(
                                  "{severity}",
                                  BUG_FINDING_SEVERITY_LABELS[finding.severity],
                                )}
                                title={en.bugHunter.severityDotLabel.replace(
                                  "{severity}",
                                  BUG_FINDING_SEVERITY_LABELS[finding.severity],
                                )}
                                className={`h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOTS[finding.severity]}`}
                              />
                            )}
                            {/* The row's real control, and the reason it is here
                              rather than on the <tr>. Carbon drops `aria-label`
                              off a TableRow and `role="button"` on a <tr> breaks
                              the table for a screen reader, so the row stays a
                              row and one cell holds a named control. It doubles
                              as the keyboard cursor's focus target. */}
                            <button
                              ref={element => {
                                rowButtonRefs.current[index] = element;
                              }}
                              type="button"
                              aria-label={en.bugHunter.rowOpenLabel.replace(
                                "{title}",
                                finding.title,
                              )}
                              title={finding.title}
                              onFocus={() => setCursorId(finding.id)}
                              onClick={event => {
                                event.stopPropagation();
                                setBug(finding.id);
                              }}
                              className="min-w-0 truncate text-left rounded cursor-pointer hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                            >
                              {finding.title}
                            </button>
                            {duplicateCount != null && (
                              <Tooltip
                                label={en.bugHunter.duplicateTooltip.replace(
                                  "{count}",
                                  String(duplicateCount),
                                )}
                                align="top"
                              >
                                <span className="shrink-0 inline-flex items-center whitespace-nowrap rounded border border-border-light bg-neutral-100 px-1.5 text-xs font-semibold text-typography-600 cursor-help">
                                  {en.bugHunter.duplicateTag.replace(
                                    "{count}",
                                    String(duplicateCount),
                                  )}
                                </span>
                              </Tooltip>
                            )}
                            {/* A shipped fix that came back — the one row state
                              where the reasonable next move is NOT to fix it
                              again. Neutral, like every chip here: the status
                              badge is the only coloured thing on a row. */}
                            {(finding.regressed || finding.regressionOf) && (
                              <Tooltip label={en.bugHunter.findingRegressedTooltip} align="top">
                                <span className="shrink-0 inline-flex items-center whitespace-nowrap rounded border border-border-light bg-neutral-100 px-1.5 text-xs font-semibold text-typography-700 cursor-help">
                                  {finding.regressionOf
                                    ? en.bugHunter.findingRegressionOfChip
                                    : en.bugHunter.findingRegressedChip}
                                </span>
                              </Tooltip>
                            )}
                            {/* Both verifiers accepted it, one of them hesitantly
                              — a reason to open THIS bug before the others. */}
                            {finding.confidence != null &&
                              finding.confidence < BUG_FINDING_LOW_CONFIDENCE_THRESHOLD && (
                                <Tooltip
                                  label={en.bugHunter.findingLowConfidenceTooltip}
                                  align="top"
                                >
                                  <span className="shrink-0 inline-flex items-center whitespace-nowrap rounded border border-border-light bg-neutral-100 px-1.5 text-xs font-semibold text-typography-600 cursor-help">
                                    {en.bugHunter.findingLowConfidenceChip}
                                  </span>
                                </Tooltip>
                              )}
                          </div>
                          {/* One meta line: where it lives and where it came
                            from. Repo and Source were a column and a line of
                            their own; file and engine/model are in the drawer.
                            The reporter stays on a human-filed bug, because
                            "who hit this" is the first thing a triager wants
                            from a real user's report. */}
                          <div className="text-xs text-typography-700 truncate">
                            {[finding.repo, BUG_FINDING_SOURCE_LABELS[finding.source]]
                              .filter(Boolean)
                              .join(" · ")}
                            {finding.report && (
                              <>
                                {" · "}
                                <span className={CONSUMER_BADGE_STYLE}>
                                  {finding.report.reporterSource === "consumer"
                                    ? en.bugHunter.reporterConsumer
                                    : en.bugHunter.reporterStaff}
                                </span>{" "}
                                {finding.report.reportedByName ?? en.bugHunter.reporterUnknown}
                              </>
                            )}
                          </div>
                        </TableCell>

                        <TableCell className={`${rowPadding} pr-3 whitespace-nowrap`}>
                          <span className="inline-flex items-center gap-1.5">
                            <BugFindingStatusBadge status={finding.status} />
                            {isMidFlight(finding.status) && (
                              <BrailleSpinner className="text-typography-500" />
                            )}
                          </span>
                        </TableCell>

                        <TableCell className={`${rowPadding} pr-3 whitespace-nowrap`}>
                          {/* The exact timestamp stays reachable as the hover
                            title; the staleness wording rides in it too, for
                            the Needs-you rows whose age is tinted. */}
                          <span
                            title={
                              tinted === "stale" || tinted === "ancient"
                                ? `${formatTimestamp(finding.createdAt)} — ${
                                    tinted === "ancient"
                                      ? en.bugHunter.findingAgeAncientTooltip
                                      : en.bugHunter.findingAgeStaleTooltip
                                  }`
                                : formatTimestamp(finding.createdAt)
                            }
                            className={`tabular-nums ${STALENESS_STYLES[tinted]}`}
                          >
                            {days == null ? "—" : formatAge(days)}
                          </span>
                        </TableCell>

                        {/* At most one button, and only where ally-be would
                          accept the move — there is no such thing as a
                          disabled one here. */}
                        {canTriage && (
                          <TableCell className={`${rowPadding} pr-3 text-right`}>
                            {step && (
                              <span
                                className="inline-flex"
                                // The row's action, not the row: a click on it
                                // must not also open the drawer behind it.
                                onClick={event => event.stopPropagation()}
                              >
                                <NextStepButton onClick={() => onNextStep(step, finding)}>
                                  {labels[step]}
                                </NextStepButton>
                              </span>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {/* Only while something is ticked — an always-present bar with a
                zero in it is a permanent strip of chrome. */}
              {selected.length > 0 && (
                <BulkTriageBar
                  selected={selected}
                  onClear={() => setSelectedIds(new Set())}
                  onSettled={actedIds =>
                    setSelectedIds(current => {
                      const next = new Set(current);
                      actedIds.forEach(id => next.delete(id));
                      return next;
                    })
                  }
                />
              )}

              {/* Closes the table's card: the count and the window caveat in
                one sentence, then rows-per-page and the pager. */}
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-b-lg border-t border-border-light bg-neutral-50 px-3 py-2">
                <p className="text-xs text-typography-600" aria-live="polite">
                  {view.matched === 1
                    ? en.bugHunter.resultSummaryOne
                    : en.bugHunter.resultSummary
                        .replace("{shown}", String(view.rows.length))
                        .replace("{matched}", String(view.matched))}
                  {view.windowed && (
                    <span className="text-typography-500">
                      {" · "}
                      {en.bugHunter.windowNotice
                        .replace("{loaded}", String(view.loaded))
                        .replace("{total}", String(view.total))}{" "}
                      <button
                        type="button"
                        onClick={handleLoadMore}
                        disabled={loadingMore}
                        className="font-medium text-primary-700 underline cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {loadingMore
                          ? en.bugHunter.loadMorePending
                          : en.bugHunter.loadMoreAction.replace(
                              "{count}",
                              String(Math.min(FINDINGS_LOAD_INCREMENT, view.total - view.loaded)),
                            )}
                      </button>
                    </span>
                  )}
                </p>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  {/* Beside the pager rather than up with the filters: it changes
                    how the results are paginated, not which results there are. */}
                  <label
                    htmlFor="bug-findings-page-size"
                    className="flex items-center gap-1.5 text-xs text-typography-600"
                  >
                    {en.bugHunter.pageSizeLabel}
                    <select
                      id="bug-findings-page-size"
                      value={pageSize}
                      onChange={event => setPageSize(Number(event.target.value) as PageSize)}
                      className="h-10 rounded-md border border-border-light bg-white pl-2 pr-6 text-xs text-typography-900 md:h-8 cursor-pointer hover:border-border-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                    >
                      {PAGE_SIZES.map(size => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </label>

                  {view.pageCount > 1 && (
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-xs text-typography-600 tabular-nums">
                        {en.bugHunter.pageStatus
                          .replace("{page}", String(view.page + 1))
                          .replace("{pages}", String(view.pageCount))}
                      </span>
                      <TablePager page={view.page} pageCount={view.pageCount} onChange={setPage} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* One dialog for every single-row decision, whichever surface asked for
          it — the row's button or the keyboard. Approve and reject are one-way
          doors in ally-be's transition map, and a fix session spends money, so
          none of them is offered without one; the bulk bar is where that cost
          is paid once instead of per bug. */}
      {pending && (
        <ActionConfirmationPopup
          isOpen
          onClose={() => setPending(null)}
          title={
            pending.action === "approve"
              ? en.bugHunter.drawerApproveConfirmTitle
              : pending.action === "reject"
                ? en.bugHunter.drawerRejectConfirmTitle
                : en.bugHunter.drawerFixSessionConfirmTitle
          }
          description={
            pending.action === "approve"
              ? en.bugHunter.drawerApproveConfirmBody
              : pending.action === "reject"
                ? en.bugHunter.drawerRejectConfirmBody
                : pending.finding.repo
                  ? en.bugHunter.drawerFixSessionConfirmBody.replace("{repo}", pending.finding.repo)
                  : en.bugHunter.drawerFixSessionConfirmBodyUnknownRepo
          }
          primaryButton={{
            label:
              pending.action === "approve"
                ? en.bugHunter.quickApproveConfirm
                : pending.action === "reject"
                  ? en.bugHunter.quickRejectConfirm
                  : en.bugHunter.drawerFixSessionStart,
            onClick: () => void runPending(),
            disabled: pending.action === "reject" && !canSubmitDecline(declineReason, declineNote),
          }}
          secondaryButton={{ label: en.bugHunter.cancel, onClick: () => setPending(null) }}
        >
          {pending.action === "reject" && (
            <DeclineReasonPicker
              idPrefix={`row-${pending.finding.id}`}
              reason={declineReason}
              onReasonChange={setDeclineReason}
              note={declineNote}
              onNoteChange={setDeclineNote}
            />
          )}
        </ActionConfirmationPopup>
      )}

      {/* Scoped barrier, keyed to the open bug. The page-level one in
          PrivateLayout would already stop a bad drawer blanking the console,
          but it would take the bugs table down with it — and the table is how
          you'd reach a different bug. */}
      {selectedId && (
        <ErrorBoundary variant="panel" resetKey={selectedId} onDismiss={() => setBug(null)}>
          <BugFindingDrawer id={selectedId} onClose={() => setBug(null)} canTriage={canTriage} />
        </ErrorBoundary>
      )}
    </div>
  );
};
