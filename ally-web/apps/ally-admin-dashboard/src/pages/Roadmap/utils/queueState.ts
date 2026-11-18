import type { RoadmapItemsQuery, RoadmapQueueSort, RoadmapQueueView, RoadmapRole } from "@types";

/**
 * The Queue's state, and its one URL-safe encoding (§4.11 "Everything has a link").
 *
 * The filter params are EXACTLY the query params of `GET /v1/roadmap/items` (P2 contract), so the
 * URL, the request and a saved view's `state.queue` are one encoding: lists comma-joined, flags
 * `1`. Page-only state (the open idea, the layout, the saved view) uses keys the API never reads.
 */

export const QUEUE_VIEWS: RoadmapQueueView[] = ["for-you", "leading", "to-triage", "all"];

export const QUEUE_SORTS: RoadmapQueueSort[] = [
  "rank",
  "waiting",
  "newest",
  "votes",
  "activity",
  "stageAge",
];

/** Multi-value filters (comma-joined on the wire). */
export const LIST_FILTER_KEYS = ["stage", "review", "goal", "author", "lead", "service"] as const;
export type ListFilterKey = (typeof LIST_FILTER_KEYS)[number];

/** On/off filters (`1` on the wire, absent when off). */
export const FLAG_FILTER_KEYS = ["starred", "openQuestion", "votedByMe"] as const;
export type FlagFilterKey = (typeof FLAG_FILTER_KEYS)[number];

export interface QueueFilters {
  q?: string;
  stage?: string[];
  review?: string[];
  goal?: string[];
  author?: string[];
  lead?: string[];
  service?: string[];
  starred?: boolean;
  openQuestion?: boolean;
  votedByMe?: boolean;
  /** YYYY-MM. */
  month?: string;
}

export type QueueLayout = "list" | "board";

export interface QueueState {
  view: RoadmapQueueView;
  filters: QueueFilters;
  /** Absent = the view's own default sort. */
  sort?: RoadmapQueueSort;
  layout: QueueLayout;
  /** The saved view this state started from, if any. */
  savedViewId?: string;
  /** The idea open in the reading pane. */
  open?: string;
}

/** URL keys the page owns; the API never sees these. */
export const PAGE_KEYS = { open: "open", layout: "layout", savedView: "sv" } as const;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The order everyone starts with: triage first, then the whole queue, then your own. */
export const DEFAULT_VIEW_ORDER: RoadmapQueueView[] = ["to-triage", "all", "leading", "for-you"];

/**
 * Which built-in views a role sees (§4.3, [FP-1023]): Idea gets two, Builder adds Leading, Owner
 * adds To triage — in the default order. A person's saved order is applied on top (`orderViews`).
 */
export const viewsForRole = (role: RoadmapRole | undefined): RoadmapQueueView[] => {
  const seen: RoadmapQueueView[] =
    role === "owner"
      ? ["for-you", "leading", "to-triage", "all"]
      : role === "builder"
        ? ["for-you", "leading", "all"]
        : ["for-you", "all"];
  return DEFAULT_VIEW_ORDER.filter(view => seen.includes(view));
};

/**
 * Apply a person's saved tab order to the views their role sees. Ids they no longer have are
 * dropped; views the saved list doesn't mention (a role gained since) follow in default order.
 */
export const orderViews = (
  allowed: RoadmapQueueView[],
  saved: readonly string[] | undefined,
): RoadmapQueueView[] => {
  const picked = (saved ?? []).filter(
    (id, i, all): id is RoadmapQueueView =>
      allowed.includes(id as RoadmapQueueView) && all.indexOf(id) === i,
  );
  return [...picked, ...allowed.filter(view => !picked.includes(view))];
};

/** The List | Board switch is for Builders and Owners (§4.3). */
export const canUseBoard = (role: RoadmapRole | undefined): boolean =>
  role === "builder" || role === "owner";

/** Each view's default sort (§4.3 table). */
export const defaultSortFor = (view: RoadmapQueueView): RoadmapQueueSort => {
  switch (view) {
    case "for-you":
      return "waiting";
    case "to-triage":
      // Backlog ideas are ranked like anything not yet released; the Owner picks from the top.
      return "rank";
    case "leading":
      // "Blocking most first": the server's waiting order puts the ideas held on the lead first.
      return "waiting";
    case "all":
    default:
      return "rank";
  }
};

/**
 * For you comes back in sections whose order the view defines, so it takes no sort. To triage keeps
 * its two sections (unreviewed first) but orders each one by the sort, Rank to begin with.
 */
export const isSectionedView = (view: RoadmapQueueView): boolean => view === "for-you";

const splitList = (raw: string | null): string[] | undefined => {
  if (!raw) return undefined;
  const values = raw
    .split(",")
    .map(v => v.trim())
    .filter(Boolean);
  return values.length ? Array.from(new Set(values)) : undefined;
};

/** Normalise filters: drop empties, dedupe and sort lists so equal filters compare equal. */
export const normaliseFilters = (filters: QueueFilters): QueueFilters => {
  const out: QueueFilters = {};
  const q = filters.q?.trim();
  if (q) out.q = q;
  for (const key of LIST_FILTER_KEYS) {
    const values = filters[key];
    if (Array.isArray(values)) {
      const clean = Array.from(new Set(values.map(v => String(v).trim()).filter(Boolean))).sort();
      if (clean.length) out[key] = clean;
    }
  }
  for (const key of FLAG_FILTER_KEYS) {
    if (filters[key]) out[key] = true;
  }
  if (filters.month && MONTH_RE.test(filters.month)) out.month = filters.month;
  return out;
};

/** Filters → the contract's string params (also a saved view's `state.queue`). */
export const filtersToParams = (filters: QueueFilters): Record<string, string> => {
  const clean = normaliseFilters(filters);
  const params: Record<string, string> = {};
  if (clean.q) params.q = clean.q;
  for (const key of LIST_FILTER_KEYS) {
    const values = clean[key];
    if (values?.length) params[key] = values.join(",");
  }
  for (const key of FLAG_FILTER_KEYS) {
    if (clean[key]) params[key] = "1";
  }
  if (clean.month) params.month = clean.month;
  return params;
};

/** The contract's string params → filters. Unknown keys are ignored. */
export const paramsToFilters = (
  params: URLSearchParams | Record<string, string | undefined>,
): QueueFilters => {
  const get = (key: string): string | null =>
    params instanceof URLSearchParams ? params.get(key) : (params[key] ?? null);
  const filters: QueueFilters = {};
  const q = get("q");
  if (q) filters.q = q;
  for (const key of LIST_FILTER_KEYS) {
    const values = splitList(get(key));
    if (values) filters[key] = values;
  }
  for (const key of FLAG_FILTER_KEYS) {
    if (get(key) === "1") filters[key] = true;
  }
  const month = get("month");
  if (month) filters.month = month;
  return normaliseFilters(filters);
};

/**
 * Read the Queue's state from the URL. A view the role can't see falls back to the first tab, so a
 * shared To triage link opens something useful for an Idea person instead of a 403.
 */
export const decodeQueueState = (
  search: URLSearchParams,
  role: RoadmapRole | undefined,
  remembered?: Partial<Pick<QueueState, "view" | "layout">>,
): QueueState => {
  const allowed = viewsForRole(role);
  const rawView = search.get("view") as RoadmapQueueView | null;
  const fallbackView =
    remembered?.view && allowed.includes(remembered.view) ? remembered.view : allowed[0];
  const view = rawView && allowed.includes(rawView) ? rawView : fallbackView;

  const rawSort = search.get("sort") as RoadmapQueueSort | null;
  const sort = rawSort && QUEUE_SORTS.includes(rawSort) ? rawSort : undefined;

  const rawLayout = search.get(PAGE_KEYS.layout);
  const wantsBoard = rawLayout ? rawLayout === "board" : remembered?.layout === "board";
  const layout: QueueLayout = wantsBoard && canUseBoard(role) ? "board" : "list";

  const state: QueueState = { view, filters: paramsToFilters(search), layout };
  if (sort) state.sort = sort;
  const savedViewId = search.get(PAGE_KEYS.savedView);
  if (savedViewId) state.savedViewId = savedViewId;
  const open = search.get(PAGE_KEYS.open);
  if (open) state.open = open;
  return state;
};

/** Write the Queue's state as URL params, defaults omitted so links stay short. */
export const encodeQueueState = (state: QueueState): URLSearchParams => {
  const params = new URLSearchParams();
  params.set("view", state.view);
  for (const [key, value] of Object.entries(filtersToParams(state.filters))) params.set(key, value);
  if (state.sort && state.sort !== defaultSortFor(state.view)) params.set("sort", state.sort);
  if (state.layout === "board") params.set(PAGE_KEYS.layout, "board");
  if (state.savedViewId) params.set(PAGE_KEYS.savedView, state.savedViewId);
  if (state.open) params.set(PAGE_KEYS.open, state.open);
  return params;
};

/** The request for `GET /v1/roadmap/items`. Sectioned views send no sort; cursor is the page's. */
export const toItemsQuery = (state: QueueState, cursor?: string): RoadmapItemsQuery => {
  const query: RoadmapItemsQuery = {
    view: state.view,
    ...(filtersToParams(state.filters) as Omit<RoadmapItemsQuery, "view">),
  };
  if (!isSectionedView(state.view)) query.sort = state.sort ?? defaultSortFor(state.view);
  if (cursor) query.cursor = cursor;
  return query;
};

export const activeFilterCount = (filters: QueueFilters): number => {
  const clean = normaliseFilters(filters);
  let count = 0;
  for (const key of LIST_FILTER_KEYS) count += clean[key]?.length ?? 0;
  for (const key of FLAG_FILTER_KEYS) if (clean[key]) count += 1;
  if (clean.month) count += 1;
  return count;
};

export const hasActiveFilters = (filters: QueueFilters): boolean =>
  activeFilterCount(filters) > 0 || !!normaliseFilters(filters).q;

/** One removable chip under the view bar. */
export interface FilterChip {
  key: ListFilterKey | FlagFilterKey | "month" | "q";
  value?: string;
}

export const filterChips = (filters: QueueFilters): FilterChip[] => {
  const clean = normaliseFilters(filters);
  const chips: FilterChip[] = [];
  if (clean.q) chips.push({ key: "q", value: clean.q });
  for (const key of LIST_FILTER_KEYS) {
    for (const value of clean[key] ?? []) chips.push({ key, value });
  }
  for (const key of FLAG_FILTER_KEYS) if (clean[key]) chips.push({ key });
  if (clean.month) chips.push({ key: "month", value: clean.month });
  return chips;
};

export const removeChip = (filters: QueueFilters, chip: FilterChip): QueueFilters => {
  const next: QueueFilters = { ...normaliseFilters(filters) };
  if (chip.key === "q" || chip.key === "month") {
    delete next[chip.key];
  } else if ((FLAG_FILTER_KEYS as readonly string[]).includes(chip.key)) {
    delete next[chip.key as FlagFilterKey];
  } else {
    const key = chip.key as ListFilterKey;
    next[key] = (next[key] ?? []).filter(v => v !== chip.value);
  }
  return normaliseFilters(next);
};

/** Filters and sort as one comparable string (for "is this saved view changed?"). */
export const queueSignature = (filters: QueueFilters, sort: RoadmapQueueSort | undefined) =>
  JSON.stringify({ f: filtersToParams(filters), s: sort ?? null });

/** A saved view's payload: the contract's params plus view and sort, all strings. */
export const savedViewPayload = (state: QueueState): Record<string, string> => {
  const payload: Record<string, string> = { view: state.view, ...filtersToParams(state.filters) };
  if (state.sort) payload.sort = state.sort;
  return payload;
};

/** Read a saved view's payload back. Unknown or disallowed views fall back like a URL does. */
export const stateFromSavedView = (
  payload: Record<string, string>,
  role: RoadmapRole | undefined,
  layout: QueueLayout,
  savedViewId: string,
): QueueState => {
  const decoded = decodeQueueState(new URLSearchParams(payload), role);
  return { ...decoded, layout, savedViewId, open: undefined };
};
