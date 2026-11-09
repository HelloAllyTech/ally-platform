import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";

import { baseAPI } from "./baseApi";

import type { CheckupRun, CheckupRunView, CheckupView } from "../types/checkup";

/** The Checkup (chunk 20a-2): an assistant's test questions, run and graded by ally-be. */
export const checkupApi = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getCheckup: builder.query<CheckupView, string>({
      query: id => ({ url: ApiEndpoints.CHATBOTS.CHECKUP(id), method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.CHECKUP],
    }),

    getCheckupRun: builder.query<CheckupRunView, { id: string; runId: string }>({
      query: ({ id, runId }) => ({
        url: ApiEndpoints.CHATBOTS.CHECKUP_RUN(id, runId),
        method: HttpMethod.GET,
      }),
    }),

    runCheckup: builder.mutation<CheckupRun, string>({
      query: id => ({
        url: ApiEndpoints.CHATBOTS.CHECKUP_RUNS(id),
        method: HttpMethod.POST,
        body: { trigger: "manual" },
      }),
      invalidatesTags: [TAG_TYPES.CHECKUP],
    }),

    runDraftCheckup: builder.mutation<{ chatbotId: string; run: CheckupRun }, string>({
      query: draftId => ({
        url: ApiEndpoints.BOT_DRAFTS.CHECKUP(draftId),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.CHECKUP],
    }),

    answerGap: builder.mutation<{ ok: true }, { id: string; caseId: string; text: string }>({
      query: ({ id, caseId, text }) => ({
        url: ApiEndpoints.CHATBOTS.CHECKUP_ANSWER(id, caseId),
        method: HttpMethod.POST,
        body: { text },
      }),
      invalidatesTags: [TAG_TYPES.CHECKUP],
    }),

    markNotOffered: builder.mutation<{ ok: true }, { id: string; caseId: string }>({
      query: ({ id, caseId }) => ({
        url: ApiEndpoints.CHATBOTS.CHECKUP_NOT_OFFERED(id, caseId),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.CHECKUP],
    }),
  }),
});

export const {
  useGetCheckupQuery,
  useLazyGetCheckupRunQuery,
  useRunCheckupMutation,
  useRunDraftCheckupMutation,
  useAnswerGapMutation,
  useMarkNotOfferedMutation,
} = checkupApi;
