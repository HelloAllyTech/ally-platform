import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import {
  BugFindingDecisionReason,
  BugFindingDetail,
  BugHuntDecision,
  BugHunterMode,
  BugHunterSettings,
  ListBugFindingsQuery,
  ListBugFindingsResponse,
  BugHunterV2Board,
  BugHunterV2DismissReason,
  BugHunterV2Mode,
  BugHunterV2ReportDetail,
  BugHunterV2Settings,
  BugHunterV2Tab,
  BugHunterV2V1BugDetail,
  BugHunterV2VerdictInput,
} from "@types";

import { baseAPI } from "./baseApi";

/**
 * Bug Hunter v2: the mode, the board, reports and verdicts (`bug_hunter_v2_verdicts` toggle).
 * `url` is read inside each query, not at module load — suites mock `@constants` wholesale.
 */
export const bugHunterV2API = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getBugHunterV2Settings: builder.query<BugHunterV2Settings, void>({
      query: () => ({ url: ApiEndpoints.BUG_HUNTER_V2.SETTINGS, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.BUG_HUNTER_V2_REPORTS],
    }),
    setBugHunterV2Mode: builder.mutation<BugHunterV2Settings, BugHunterV2Mode>({
      query: mode => ({
        url: ApiEndpoints.BUG_HUNTER_V2.MODE,
        method: HttpMethod.PUT,
        body: { mode },
      }),
      invalidatesTags: [TAG_TYPES.BUG_HUNTER_V2_REPORTS],
    }),
    getBugHunterV2Bugs: builder.query<BugHunterV2Board, { tab: BugHunterV2Tab }>({
      query: ({ tab }) => ({
        url: ApiEndpoints.BUG_HUNTER_V2.BUGS,
        method: HttpMethod.GET,
        params: { tab },
      }),
      providesTags: [TAG_TYPES.BUG_HUNTER_V2_REPORTS],
    }),
    startBugHunterV2Bug: builder.mutation<unknown, { id: number; app?: string }>({
      query: ({ id, app }) => ({
        url: ApiEndpoints.BUG_HUNTER_V2.START(id),
        method: HttpMethod.POST,
        body: app ? { app } : {},
      }),
      invalidatesTags: [TAG_TYPES.BUG_HUNTER_V2_REPORTS],
    }),
    getBugHunterV2V1Bug: builder.query<BugHunterV2V1BugDetail, string>({
      query: findingId => ({
        url: ApiEndpoints.BUG_HUNTER_V2.V1_BUG(findingId),
        method: HttpMethod.GET,
      }),
      providesTags: [TAG_TYPES.BUG_HUNTER_V2_REPORTS],
    }),
    dismissBugHunterV2Bug: builder.mutation<
      unknown,
      { id: number; reason: BugHunterV2DismissReason; note?: string }
    >({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.BUG_HUNTER_V2.DISMISS(id),
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [TAG_TYPES.BUG_HUNTER_V2_REPORTS],
    }),
    bulkBugHunterV2Bugs: builder.mutation<
      { done: number; results: { id: number; ok: boolean; message?: string }[] },
      { action: "start" | "dismiss"; ids: number[]; reason?: BugHunterV2DismissReason }
    >({
      query: body => ({ url: ApiEndpoints.BUG_HUNTER_V2.BULK, method: HttpMethod.POST, body }),
      invalidatesTags: [TAG_TYPES.BUG_HUNTER_V2_REPORTS],
    }),
    openBugHunterV2Pr: builder.mutation<unknown, number>({
      query: id => ({ url: ApiEndpoints.BUG_HUNTER_V2.OPEN_PR(id), method: HttpMethod.POST }),
      invalidatesTags: [TAG_TYPES.BUG_HUNTER_V2_REPORTS],
    }),
    mergeBugHunterV2Pr: builder.mutation<unknown, number>({
      query: id => ({ url: ApiEndpoints.BUG_HUNTER_V2.MERGE(id), method: HttpMethod.POST }),
      invalidatesTags: [TAG_TYPES.BUG_HUNTER_V2_REPORTS],
    }),
    releaseBugHunterV2Bug: builder.mutation<{ tag?: string }, number>({
      query: id => ({ url: ApiEndpoints.BUG_HUNTER_V2.RELEASE(id), method: HttpMethod.POST }),
      invalidatesTags: [TAG_TYPES.BUG_HUNTER_V2_REPORTS],
    }),
    // ── the old Bug Hunter's shapes over v2's queue (chunk 11, the exact-match page) ──
    getBugHunterV2CompatSettings: builder.query<BugHunterSettings, void>({
      query: () => ({ url: ApiEndpoints.BUG_HUNTER_V2.COMPAT_SETTINGS, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.BUG_HUNTER_V2_REPORTS],
    }),
    updateBugHunterV2CompatSettings: builder.mutation<BugHunterSettings, { mode: BugHunterMode }>({
      query: body => ({
        url: ApiEndpoints.BUG_HUNTER_V2.COMPAT_SETTINGS,
        method: HttpMethod.PUT,
        body,
      }),
      invalidatesTags: [TAG_TYPES.BUG_HUNTER_V2_REPORTS],
    }),
    getBugHunterV2CompatFindings: builder.query<
      ListBugFindingsResponse,
      ListBugFindingsQuery | void
    >({
      query: q => ({
        url: ApiEndpoints.BUG_HUNTER_V2.COMPAT_FINDINGS,
        method: HttpMethod.GET,
        params: q ? { limit: q.limit, offset: q.offset } : undefined,
      }),
      providesTags: [TAG_TYPES.BUG_HUNTER_V2_REPORTS],
    }),
    getBugHunterV2CompatFinding: builder.query<BugFindingDetail, string>({
      query: id => ({ url: ApiEndpoints.BUG_HUNTER_V2.COMPAT_FINDING(id), method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.BUG_HUNTER_V2_REPORTS],
    }),
    getBugHunterV2CompatDecisions: builder.query<BugHuntDecision[], string>({
      query: id => ({
        url: ApiEndpoints.BUG_HUNTER_V2.COMPAT_FINDING_ACTION(id, "decisions"),
        method: HttpMethod.GET,
      }),
    }),
    approveBugHunterV2Compat: builder.mutation<BugFindingDetail, string>({
      query: id => ({
        url: ApiEndpoints.BUG_HUNTER_V2.COMPAT_FINDING_ACTION(id, "approve"),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.BUG_HUNTER_V2_REPORTS],
    }),
    rejectBugHunterV2Compat: builder.mutation<
      BugFindingDetail,
      { id: string; reason: BugFindingDecisionReason; note?: string }
    >({
      query: ({ id, reason, note }) => ({
        url: ApiEndpoints.BUG_HUNTER_V2.COMPAT_FINDING_ACTION(id, "reject"),
        method: HttpMethod.POST,
        body: { reason, ...(note?.trim() ? { note: note.trim() } : {}) },
      }),
      invalidatesTags: [TAG_TYPES.BUG_HUNTER_V2_REPORTS],
    }),
    startBugHunterV2Compat: builder.mutation<
      BugFindingDetail,
      { id: string; repo?: string; force?: boolean }
    >({
      query: ({ id }) => ({
        url: ApiEndpoints.BUG_HUNTER_V2.COMPAT_FINDING_ACTION(id, "fix-session"),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.BUG_HUNTER_V2_REPORTS],
    }),
    mergeBugHunterV2Compat: builder.mutation<BugFindingDetail, { id: string; force?: boolean }>({
      query: ({ id }) => ({
        url: ApiEndpoints.BUG_HUNTER_V2.COMPAT_FINDING_ACTION(id, "merge"),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.BUG_HUNTER_V2_REPORTS],
    }),
    releaseBugHunterV2Compat: builder.mutation<BugFindingDetail, string>({
      query: id => ({
        url: ApiEndpoints.BUG_HUNTER_V2.COMPAT_FINDING_ACTION(id, "release"),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.BUG_HUNTER_V2_REPORTS],
    }),
    getBugHunterV2Report: builder.query<BugHunterV2ReportDetail, number>({
      query: id => ({ url: ApiEndpoints.BUG_HUNTER_V2.REPORT(id), method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.BUG_HUNTER_V2_REPORTS],
    }),
    recordBugHunterV2Verdict: builder.mutation<unknown, BugHunterV2VerdictInput>({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.BUG_HUNTER_V2.VERDICT(id),
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [TAG_TYPES.BUG_HUNTER_V2_REPORTS],
    }),
  }),
});

export const {
  useGetBugHunterV2SettingsQuery,
  useSetBugHunterV2ModeMutation,
  useGetBugHunterV2BugsQuery,
  useStartBugHunterV2BugMutation,
  useDismissBugHunterV2BugMutation,
  useBulkBugHunterV2BugsMutation,
  useOpenBugHunterV2PrMutation,
  useMergeBugHunterV2PrMutation,
  useReleaseBugHunterV2BugMutation,
  useGetBugHunterV2CompatSettingsQuery,
  useUpdateBugHunterV2CompatSettingsMutation,
  useGetBugHunterV2CompatFindingsQuery,
  useGetBugHunterV2CompatFindingQuery,
  useGetBugHunterV2CompatDecisionsQuery,
  useApproveBugHunterV2CompatMutation,
  useRejectBugHunterV2CompatMutation,
  useStartBugHunterV2CompatMutation,
  useMergeBugHunterV2CompatMutation,
  useReleaseBugHunterV2CompatMutation,
  useGetBugHunterV2ReportQuery,
  useGetBugHunterV2V1BugQuery,
  useRecordBugHunterV2VerdictMutation,
} = bugHunterV2API;
