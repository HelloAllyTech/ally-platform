import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import { BugHunterV2ReportDetail, BugHunterV2VerdictInput } from "@types";

import { baseAPI } from "./baseApi";

/**
 * Bug Hunter v2's report page: one report (finding, failing test, patch, reviewer) and the
 * two-part verdict that teaches it (`bug_hunter_v2_verdicts` toggle). The page itself is
 * the old Bug Hunter's, in `api/bugHunter.ts`. `url` is read inside each query, not at
 * module load — suites mock `@constants` wholesale.
 */
export const bugHunterV2API = baseAPI.injectEndpoints({
  endpoints: builder => ({
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
      invalidatesTags: [TAG_TYPES.BUG_HUNTER_V2_REPORTS, TAG_TYPES.BUG_HUNTER_FINDINGS],
    }),
  }),
});

export const { useGetBugHunterV2ReportQuery, useRecordBugHunterV2VerdictMutation } = bugHunterV2API;
