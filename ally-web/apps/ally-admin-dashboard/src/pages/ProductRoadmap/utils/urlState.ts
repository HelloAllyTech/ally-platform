import { RoadmapBoardLayout, RoadmapViewState } from "@types";

/**
 * The slice of the roadmap's filter/sort/layout state that lives in the URL.
 *
 * Bug Hunter keeps all of this in the query string; the roadmap kept it in `useState`, so a
 * refresh or a pasted link dropped everything the sender was looking at. Keys are short because
 * people paste these:
 *
 *   q=text  type=…  stage=…  goal=…  owner=…  eff=…  src=…  sort=field  dir=asc|desc  layout=…
 *
 * List values are comma-joined with each item percent-encoded, so a goal called "Scribe, notes"
 * survives. Dates and the priority range are NOT here: they are rare, and `?view=` already covers
 * the cases where someone needs them to travel.
 */
export const URL_STATE_KEYS = [
  "q",
  "type",
  "stage",
  "goal",
  "owner",
  "eff",
  "src",
  "sort",
  "dir",
  "layout",
  "archived",
] as const;

const LIST_KEYS = {
  type: "typeFilter",
  stage: "stageFilter",
  goal: "goalFilter",
  owner: "ownerFilter",
  eff: "effortFilter",
  src: "sourceFilter",
} as const;

const LAYOUTS: string[] = Object.values(RoadmapBoardLayout);

const encodeList = (values: string[]) => values.map(encodeURIComponent).join(",");
const decodeList = (raw: string) =>
  raw
    .split(",")
    .filter(Boolean)
    .map(part => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });

/** Only the keys present in the URL come back, so absent means "leave the view's value alone". */
export const parseUrlState = (params: URLSearchParams): RoadmapViewState => {
  const state: RoadmapViewState = {};
  const q = params.get("q");
  if (q) state.searchQuery = q;
  (Object.keys(LIST_KEYS) as (keyof typeof LIST_KEYS)[]).forEach(key => {
    const raw = params.get(key);
    if (raw) state[LIST_KEYS[key]] = decodeList(raw);
  });
  const sort = params.get("sort");
  if (sort) {
    state.sort = { field: sort, dir: params.get("dir") === "asc" ? "asc" : "desc" };
  }
  if (params.get("archived") === "1") state.showArchived = true;
  const layout = params.get("layout");
  if (layout && LAYOUTS.includes(layout)) state.layout = layout as RoadmapBoardLayout;
  return state;
};

/**
 * Writes the state onto a COPY of `params`, touching only this file's keys (tab, view, opportunity
 * and the rest ride along). Empty values are removed rather than written, so a clean board has a
 * clean URL.
 *
 * `omitStage` is for the Queue, whose stage filter is its definition rather than something the
 * reader chose — writing it would put a long constant in every Queue link.
 */
export const writeUrlState = (
  params: URLSearchParams,
  state: RoadmapViewState,
  options: { omitStage?: boolean } = {},
): URLSearchParams => {
  const next = new URLSearchParams(params);
  URL_STATE_KEYS.forEach(key => next.delete(key));
  if (state.searchQuery) next.set("q", state.searchQuery);
  (Object.keys(LIST_KEYS) as (keyof typeof LIST_KEYS)[]).forEach(key => {
    if (key === "stage" && options.omitStage) return;
    const values = state[LIST_KEYS[key]];
    if (values?.length) next.set(key, encodeList(values));
  });
  if (state.showArchived && !options.omitStage) next.set("archived", "1");
  if (state.sort) {
    next.set("sort", state.sort.field);
    next.set("dir", state.sort.dir);
  }
  // Always written, including the default table: a Queue link has to say "table" explicitly or the
  // landing view's own layout (List) would win over the reader's.
  next.set("layout", state.layout ?? RoadmapBoardLayout.TABLE);
  return next;
};

/** Merge URL values over a base state. Present URL keys win; everything else is untouched. */
export const overlayUrlState = (
  base: RoadmapViewState,
  url: RoadmapViewState,
  options: { ignoreStage?: boolean } = {},
): RoadmapViewState => {
  const merged: RoadmapViewState = { ...base, ...url };
  if (options.ignoreStage) merged.stageFilter = base.stageFilter;
  return merged;
};
