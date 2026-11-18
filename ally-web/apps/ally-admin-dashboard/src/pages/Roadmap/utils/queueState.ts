import type { RoadmapItemsQuery, RoadmapQueueSort, RoadmapQueueView } from "@types";

/**
 * The Queue's state, and its one URL-safe encoding (§4.11 "Everything has a link").
 *
 * The filter params are EXACTLY the query params of `GET /v1/roadmap/items` (P2 contract), so the
 * URL, the request and a saved view's `state.queue` are one encoding: lists comma-joined, flags
 * `1`. Page-only state (the open idea, the saved view) uses keys the API never reads.
 */

/**
 * The Queue is one list. What used to be separate views are filters: five default views (they can't
 * be removed) and the saved views a person makes. Every idea is in All, and in exactly one of the
 * other four: To do (Backlog: nobody leads it), Building, Released, Declined.
 */
export type DefaultViewId = "all" | "todo" | "building" | "released" | "declined";
export const DEFAULT_VIEW_IDS: DefaultViewId[] = [
  "all",
  "todo",
  "building",
  "released",
  "declined",
];

export const QUEUE_VIEWS: RoadmapQueueView[] = ["for-you", "leading", "to-triage", "all"];

export const QUEUE_SORTS: RoadmapQueueSort[] = [
  "rank",
  "waiting",
  "newest",
  "votes",
  "activity",
  "stageAge",
  "stageNewest",
];

/** Multi-value filters (comma-joined on the wire). */
export const LIST_FILTER_KEYS = ["stage", "review", "goal", "author", "lead", "service"] as const;
export type ListFilterKey = (typeof LIST_FILTER_KEYS)[number];

/** On/off filters (`1` on the wire, absent when off). */
export const FLAG_FILTER_KEYS = [
  "starred",
  "openQuestion",
  "votedByMe",
  "ledByMe",
  "wroteByMe",
  "needsYou",
] as const;
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
  /** Ideas I lead. */
  ledByMe?: boolean;
  /** Ideas I wrote. */
  wroteByMe?: boolean;
  /** Something is waiting on me: an agent question, a decision, an @mention. */
  needsYou?: boolean;
  /** YYYY-MM. */
  month?: string;
}

export interface QueueState {
  /** The default view you are on. A saved view reads as All with its own filters (`savedViewId`). */
  view: DefaultViewId;
  filters: QueueFilters;
  /** Absent = the view's own default sort. */
  sort?: RoadmapQueueSort;
  /** The saved view this state started from, if any. */
  savedViewId?: string;
  /** The idea open in the reading pane. */
  open?: string;
}

/** URL keys the page owns; the API never sees these. */
export const PAGE_KEYS = { open: "open", savedView: "sv" } as const;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** What each default view is: the filters it implies, and the sort it opens on. */
export const DEFAULT_VIEWS: Record<
  DefaultViewId,
  { filters: QueueFilters; sort: RoadmapQueueSort }
> = {
  all: { filters: {}, sort: "rank" },
  // Backlog: nobody leads it yet. Ranked, so the Owner picks from the top.
  todo: { filters: { stage: ["backlog"] }, sort: "rank" },
  building: { filters: { stage: ["being_built"] }, sort: "activity" },
  released: { filters: { stage: ["shipped"] }, sort: "stageNewest" },
  declined: { filters: { stage: ["declined"] }, sort: "stageNewest" },
};

/** A saved view that names no sort opens on Rank. */
export const SAVED_VIEW_DEFAULT_SORT: RoadmapQueueSort = "rank";

/**
 * Apply a person's saved tab order to the tabs there are (the five defaults and their saved views).
 * Ids that no longer exist are dropped; tabs the saved list doesn't mention follow, in order.
 */
export const orderViews = <T extends string>(
  allowed: T[],
  saved: readonly string[] | undefined,
): T[] => {
  const picked = (saved ?? []).filter(
    (id, i, all): id is T => allowed.includes(id as T) && all.indexOf(id) === i,
  );
  return [...picked, ...allowed.filter(view => !picked.includes(view))];
};

/** The sort a default view opens on. Legacy view ids fall back to Rank. */
export const defaultSortFor = (view: string): RoadmapQueueSort =>
  DEFAULT_VIEWS[view as DefaultViewId]?.sort ?? SAVED_VIEW_DEFAULT_SORT;

/** Legacy: the old For you view came back in sections. Nothing is sectioned any more. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const isSectionedView = (_view: string): boolean => false;

/**
 * A view name from an old link, a remembered view or a saved view, read as the default view and
 * extra filters it falls under now: For you was ideas waiting on you, Leading ideas you lead, and
 * To triage is To do.
 */
export const readView = (
  raw: string | null | undefined,
): { view: DefaultViewId; filters: QueueFilters } | null => {
  if (!raw) return null;
  if ((DEFAULT_VIEW_IDS as string[]).includes(raw))
    return { view: raw as DefaultViewId, filters: {} };
  if (raw === "to-triage") return { view: "todo", filters: {} };
  if (raw === "leading") return { view: "all", filters: { ledByMe: true } };
  if (raw === "for-you") return { view: "all", filters: { needsYou: true } };
  return null;
};

/** The filters a request or a count carries: the default view's own, then the person's on top. */
export const effectiveFilters = (state: Pick<QueueState, "view" | "filters">): QueueFilters => ({
  ...state.filters,
  ...DEFAULT_VIEWS[state.view].filters,
});

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
 * Read the Queue's state from the URL. A view name from before the five default views reads as the
 * view and filters it falls under now, so an old link or saved view still opens on the same ideas.
 */
export const decodeQueueState = (
  search: URLSearchParams,
  remembered?: { view?: string },
): QueueState => {
  const fromUrl = readView(search.get("view"));
  const fromMemory = readView(remembered?.view);
  const chosen = fromUrl ?? fromMemory ?? { view: "all" as DefaultViewId, filters: {} };
  const view = chosen.view;

  const rawSort = search.get("sort") as RoadmapQueueSort | null;
  const sort = rawSort && QUEUE_SORTS.includes(rawSort) ? rawSort : undefined;

  // Filters a legacy view name implies (For you, Leading) ride along; the URL's own come after.
  const state: QueueState = {
    view,
    filters: normaliseFilters({ ...chosen.filters, ...paramsToFilters(search) }),
  };
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
  if (state.sort && state.sort !== defaultSortFor(state.savedViewId ? "saved" : state.view)) {
    params.set("sort", state.sort);
  }
  if (state.savedViewId) params.set(PAGE_KEYS.savedView, state.savedViewId);
  if (state.open) params.set(PAGE_KEYS.open, state.open);
  return params;
};

/**
 * The request for `GET /v1/roadmap/items`. It is always the one list (`all`): the default view's
 * own filters and the person's go in as filters, and `sort` is the one in force. The cursor is the
 * page's.
 */
export const toItemsQuery = (state: QueueState, cursor?: string): RoadmapItemsQuery => {
  const query: RoadmapItemsQuery = {
    view: "all",
    ...(filtersToParams(effectiveFilters(state)) as Omit<RoadmapItemsQuery, "view">),
  };
  query.sort = state.sort ?? defaultSortFor(state.savedViewId ? "saved" : state.view);
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
  const payload: Record<string, string> = {
    view: "all",
    ...filtersToParams(effectiveFilters(state)),
  };
  if (state.sort) payload.sort = state.sort;
  return payload;
};

/** Read a saved view's payload back. Unknown or disallowed views fall back like a URL does. */
export const stateFromSavedView = (
  payload: Record<string, string>,
  savedViewId: string,
): QueueState => {
  const decoded = decodeQueueState(new URLSearchParams(payload));
  // A saved view is its own list: it starts from All, whatever view it was saved from. The
  // default view it was saved on (To do, say) is part of its filters, so nothing is lost.
  const filters = normaliseFilters({ ...DEFAULT_VIEWS[decoded.view].filters, ...decoded.filters });
  return { ...decoded, view: "all", filters, savedViewId, open: undefined };
};
