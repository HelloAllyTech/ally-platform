import { ApiEndpoints, HttpMethod } from "@constants";
import { SubmitDebriefFeedbackRequest, SubmitDebriefFeedbackResponse } from "@types";

import { baseAPI } from "./baseAPI";

export const sessionAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    submitDebriefFeedback: builder.mutation<
      SubmitDebriefFeedbackResponse,
      SubmitDebriefFeedbackRequest
    >({
      query: ({ sessionId, ...body }) => ({
        url: ApiEndpoints.LEARN.SUBMIT_DEBRIEF_FEEDBACK(sessionId),
        method: HttpMethod.POST,
        body,
      }),
    }),
  }),
});

export const { useSubmitDebriefFeedbackMutation } = sessionAPI;
