import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import {
  BugHunterV2Board,
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
  useGetBugHunterV2ReportQuery,
  useGetBugHunterV2V1BugQuery,
  useRecordBugHunterV2VerdictMutation,
} = bugHunterV2API;
