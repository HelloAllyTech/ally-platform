import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import {
  RoadmapItemDetail,
  RoadmapItemPatch,
  RoadmapItemRow,
  RoadmapItemsQuery,
  RoadmapItemsResponse,
  RoadmapMeRole,
  RoadmapSearchResponse,
  RoadmapStarResponse,
  RoadmapWatchLevel,
} from "@types";

import { baseAPI } from "./baseApi";

/**
 * Every row in a list response, sections or flat. A section the server sends as something other
 * than an array is skipped rather than trusted (agent-authored arrays get an Array.isArray guard).
 */
export const rowsOfItemsResponse = (
  response: RoadmapItemsResponse | undefined,
): RoadmapItemRow[] => {
  if (!response) return [];
  if ("rows" in response) return Array.isArray(response.rows) ? response.rows : [];
  if ("sections" in response && response.sections && typeof response.sections === "object") {
    return Object.values(response.sections).flatMap(section =>
      Array.isArray(section) ? (section as RoadmapItemRow[]) : [],
    );
  }
  return [];
};

const listTag = { type: TAG_TYPES.ROADMAP_V2_ITEMS, id: "LIST" } as const;
const itemTag = (code: string) => ({ type: TAG_TYPES.ROADMAP_V2_ITEMS, id: code.toUpperCase() });

/**
 * Roadmap v2's read model (P2 contract). Low-risk writes — mark read, watch, star — patch every
 * cached copy first and undo on failure (§4.12). A patch only reaches an entry that already holds
 * data, so the components that show these values also keep their own local state; the patch is
 * the optimisation, not the mechanism.
 */
export const roadmapV2API = baseAPI.injectEndpoints({
  endpoints: builder => ({
    /** Succeeds only while `roadmap_v2` is on (404 otherwise): the flag check for the whole area. */
    getRoadmapMeRole: builder.query<RoadmapMeRole, void>({
      query: () => ({ url: ApiEndpoints.ROADMAP_V2.ME_ROLE, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.ROADMAP_V2_ROLE],
    }),

    getRoadmapItems: builder.query<RoadmapItemsResponse, RoadmapItemsQuery>({
      query: params => ({ url: ApiEndpoints.ROADMAP_V2.ITEMS, method: HttpMethod.GET, params }),
      providesTags: result => [
        listTag,
        ...rowsOfItemsResponse(result).map(row => itemTag(row.code)),
      ],
    }),

    getRoadmapItem: builder.query<RoadmapItemDetail, string>({
      query: code => ({ url: ApiEndpoints.ROADMAP_V2.ITEM(code), method: HttpMethod.GET }),
      providesTags: (result, _error, code) => [itemTag(result?.code ?? code)],
    }),

    searchRoadmap: builder.query<RoadmapSearchResponse, string>({
      query: q => ({ url: ApiEndpoints.ROADMAP_V2.SEARCH, method: HttpMethod.GET, params: { q } }),
      keepUnusedDataFor: 30,
    }),

    patchRoadmapItem: builder.mutation<
      RoadmapItemDetail,
      { code: string; patch: RoadmapItemPatch }
    >({
      query: ({ code, patch }) => ({
        url: ApiEndpoints.ROADMAP_V2.ITEM(code),
        method: HttpMethod.PATCH,
        body: patch,
      }),
      invalidatesTags: (_result, _error, { code }) => [itemTag(code), listTag],
    }),

    markRoadmapItemRead: builder.mutation<void, string>({
      query: code => ({ url: ApiEndpoints.ROADMAP_V2.ITEM_READ(code), method: HttpMethod.POST }),
      // No tags: the patch below is the whole update, and a refetch of every list on every row
      // opened would reorder the list under the reader (§4.12, frozen order).
      async onQueryStarted(code, { dispatch, getState, queryFulfilled }) {
        const undo = patchEveryCachedRow(dispatch, getState, code, row => {
          row.unread = false;
        });
        try {
          await queryFulfilled;
        } catch {
          undo();
        }
      },
    }),

    setRoadmapWatch: builder.mutation<
      { level: RoadmapWatchLevel },
      { code: string; level: RoadmapWatchLevel }
    >({
      query: ({ code, level }) => ({
        url: ApiEndpoints.ROADMAP_V2.ITEM_WATCH(code),
        method: HttpMethod.PUT,
        body: { level },
      }),
      async onQueryStarted({ code, level }, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          roadmapV2API.util.updateQueryData("getRoadmapItem", code, draft => {
            draft.watchLevel = level;
          }),
        );
        try {
          await queryFulfilled;
        } catch {
          patch.undo();
        }
      },
    }),

    setRoadmapStar: builder.mutation<RoadmapStarResponse, { code: string; starred: boolean }>({
      query: ({ code, starred }) => ({
        url: ApiEndpoints.ROADMAP_V2.ITEM_STAR(code),
        method: starred ? HttpMethod.POST : HttpMethod.DELETE,
      }),
      async onQueryStarted({ code, starred }, { dispatch, getState, queryFulfilled }) {
        const undoRows = patchEveryCachedRow(dispatch, getState, code, row => {
          row.starred = starred;
        });
        const undoItem = dispatch(
          roadmapV2API.util.updateQueryData("getRoadmapItem", code, draft => {
            draft.starred = starred;
          }),
        );
        try {
          const { data } = await queryFulfilled;
          // Reconcile quietly: the server names who starred it.
          dispatch(
            roadmapV2API.util.updateQueryData("getRoadmapItem", code, draft => {
              draft.starred = data.starred;
              draft.starredBy = data.starredBy;
            }),
          );
        } catch {
          undoRows();
          undoItem.undo();
        }
      },
    }),
  }),
});

type Dispatch = (action: unknown) => unknown;

/**
 * Apply `mutate` to the row with `code` in every cached list (the args trap: a patch keyed by the
 * wrong args silently no-ops, so this walks every cached args instead of guessing one).
 */
const patchEveryCachedRow = (
  dispatch: Dispatch,
  getState: () => unknown,
  code: string,
  mutate: (row: RoadmapItemRow) => void,
): (() => void) => {
  const state = getState() as Parameters<typeof roadmapV2API.util.selectCachedArgsForQuery>[0];
  const wanted = code.toUpperCase();
  const patches = roadmapV2API.util.selectCachedArgsForQuery(state, "getRoadmapItems").map(
    args =>
      dispatch(
        roadmapV2API.util.updateQueryData("getRoadmapItems", args, draft => {
          rowsOfItemsResponse(draft)
            .filter(row => row.code.toUpperCase() === wanted)
            .forEach(mutate);
        }),
      ) as { undo: () => void },
  );
  return () => patches.forEach(patch => patch.undo());
};

export const {
  useGetRoadmapMeRoleQuery,
  useGetRoadmapItemsQuery,
  useGetRoadmapItemQuery,
  usePrefetch: useRoadmapV2Prefetch,
  useSearchRoadmapQuery,
  usePatchRoadmapItemMutation,
  useMarkRoadmapItemReadMutation,
  useSetRoadmapWatchMutation,
  useSetRoadmapStarMutation,
} = roadmapV2API;
