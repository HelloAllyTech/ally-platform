import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import {
  BugFinding,
  BugFindingDecisionReason,
  BugFindingDetail,
  BugHuntDecision,
  BugHunterMode,
  BugHunterSettings,
  ListBugFindingsQuery,
  ListBugFindingsResponse,
} from "@types";

import { baseAPI } from "./baseApi";

const V2 = () => ApiEndpoints.BUG_HUNTER_V2;

const touches = (id: string) => [
  { type: TAG_TYPES.BUG_HUNTER_FINDINGS, id },
  { type: TAG_TYPES.BUG_HUNTER_FINDINGS, id: "LIST" },
];

/**
 * Bug Hunter's page data (the old page's components, now Bug Hunter v2's page).
 *
 * Since the old engine was removed (2026-11-23) every call goes to Bug Hunter v2's
 * compat routes in ally-be: v2's queue plus the old Bug Hunter's history (read-only), in
 * the shapes these components were written for. The buttons map onto v2: Approve opens
 * a PR on a suggested fix (or puts the bug on), Put me on it queues it, Decline dismisses
 * it, Merge and Release are v2's. `url`s are read inside each query, not at module load
 * (suites mock `@constants` wholesale).
 */
export const bugHunterAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getBugHunterSettings: builder.query<BugHunterSettings, void>({
      query: () => ({ url: V2().COMPAT_SETTINGS, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.BUG_HUNTER_SETTINGS],
    }),

    updateBugHunterSettings: builder.mutation<BugHunterSettings, { mode: BugHunterMode }>({
      query: body => ({ url: V2().COMPAT_SETTINGS, method: HttpMethod.PUT, body }),
      invalidatesTags: [TAG_TYPES.BUG_HUNTER_SETTINGS],
    }),

    getBugFindings: builder.query<ListBugFindingsResponse, ListBugFindingsQuery | void>({
      query: query => ({
        url: V2().COMPAT_FINDINGS,
        method: HttpMethod.GET,
        params: query ? { limit: query.limit, offset: query.offset } : undefined,
      }),
      providesTags: [{ type: TAG_TYPES.BUG_HUNTER_FINDINGS, id: "LIST" }],
    }),

    getBugFinding: builder.query<BugFindingDetail, string>({
      query: id => ({ url: V2().COMPAT_FINDING(id), method: HttpMethod.GET }),
      providesTags: (_result, _error, id) => [{ type: TAG_TYPES.BUG_HUNTER_FINDINGS, id }],
    }),

    getBugFindingDecisions: builder.query<BugHuntDecision[], string>({
      query: id => ({
        url: V2().COMPAT_FINDING_ACTION(id, "decisions"),
        method: HttpMethod.GET,
      }),
      providesTags: (_result, _error, id) => [{ type: TAG_TYPES.BUG_HUNTER_FINDINGS, id }],
    }),

    /** Approve: Open PR on a suggested fix; Put me on it for a bug not started yet. */
    approveBugFinding: builder.mutation<BugFindingDetail, string>({
      query: id => ({
        url: V2().COMPAT_FINDING_ACTION(id, "approve"),
        method: HttpMethod.POST,
      }),
      invalidatesTags: (_result, _error, id) => touches(id),
    }),

    /** Decline: dismiss with the reason (not a bug and wrong repo also teach a verdict). */
    rejectBugFinding: builder.mutation<
      BugFindingDetail,
      { id: string; reason: BugFindingDecisionReason; note?: string }
    >({
      query: ({ id, reason, note }) => ({
        url: V2().COMPAT_FINDING_ACTION(id, "reject"),
        method: HttpMethod.POST,
        body: { reason, ...(note?.trim() ? { note: note.trim() } : {}) },
      }),
      invalidatesTags: (_result, _error, { id }) => touches(id),
    }),

    /** Put me on it: queue the bug for the worker. */
    startBugFixSession: builder.mutation<
      BugFinding,
      { id: string; repo?: string; force?: boolean }
    >({
      query: ({ id }) => ({
        url: V2().COMPAT_FINDING_ACTION(id, "fix-session"),
        method: HttpMethod.POST,
      }),
      invalidatesTags: (_result, _error, { id }) => touches(id),
    }),

    /** Merge the bug's PR (a person's click; GitHub's refusal is shown as it comes). */
    mergeBugFinding: builder.mutation<BugFinding, { id: string; force?: boolean }>({
      query: ({ id }) => ({
        url: V2().COMPAT_FINDING_ACTION(id, "merge"),
        method: HttpMethod.POST,
      }),
      invalidatesTags: (_result, _error, { id }) => touches(id),
    }),

    /** Release a merged fix: the app's production-release workflow is dispatched. */
    releaseBugFinding: builder.mutation<BugFinding, string>({
      query: id => ({
        url: V2().COMPAT_FINDING_ACTION(id, "release"),
        method: HttpMethod.POST,
      }),
      invalidatesTags: (_result, _error, id) => touches(id),
    }),
  }),
});

export const {
  useGetBugHunterSettingsQuery,
  useUpdateBugHunterSettingsMutation,
  useGetBugFindingsQuery,
  useGetBugFindingQuery,
  useGetBugFindingDecisionsQuery,
  useApproveBugFindingMutation,
  useRejectBugFindingMutation,
  useStartBugFixSessionMutation,
  useMergeBugFindingMutation,
  useReleaseBugFindingMutation,
} = bugHunterAPI;
