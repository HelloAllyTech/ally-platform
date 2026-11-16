import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import {
  BugHunterV2ReportDetail,
  BugHunterV2ReportFilter,
  BugHunterV2ReportItem,
  BugHunterV2VerdictInput,
} from "@types";

import { baseAPI } from "./baseApi";

/**
 * Bug Hunter v2 reports and verdicts: the `bug_hunter_v2_verdicts` admin toggle.
 * `url` is read inside each query, not at module load — suites mock `@constants` wholesale.
 */
export const bugHunterV2API = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getBugHunterV2Reports: builder.query<
      BugHunterV2ReportItem[],
      { status: BugHunterV2ReportFilter }
    >({
      query: ({ status }) => ({
        url: ApiEndpoints.BUG_HUNTER_V2.REPORTS,
        method: HttpMethod.GET,
        params: { status },
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
  useGetBugHunterV2ReportsQuery,
  useGetBugHunterV2ReportQuery,
  useRecordBugHunterV2VerdictMutation,
} = bugHunterV2API;
