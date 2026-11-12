import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import { ExpertReviewDetail, ExpertVerdict } from "@types";

import { baseAPI } from "./baseApi";

/**
 * Expert review of Debrief agent debriefs: the verdict, given from the session page's Review panel.
 * `url` is read inside each query, not at module load — suites mock `@constants` wholesale.
 */
export const debriefExpertReviewAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    setExpertVerdict: builder.mutation<
      ExpertReviewDetail,
      { runId: string; verdict: ExpertVerdict; hardFails: string[] }
    >({
      query: ({ runId, ...body }) => ({
        url: ApiEndpoints.DEBRIEF_EXPERT_REVIEW.VERDICT(runId),
        method: HttpMethod.PUT,
        body,
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_EXPERT_REVIEW],
    }),
  }),
});

export const { useSetExpertVerdictMutation } = debriefExpertReviewAPI;
