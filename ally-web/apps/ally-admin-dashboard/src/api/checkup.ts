import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";

import { baseAPI } from "./baseApi";

import type {
  CheckupCase,
  CheckupCaseInput,
  CheckupResult,
  CheckupRun,
  CheckupRunView,
  CheckupSuggestion,
  CheckupView,
} from "../types/checkup";

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

    /** Run all, or (chunk 20d-2) only the questions that didn't pass last time. */
    runCheckup: builder.mutation<CheckupRun, string | { id: string; only?: "all" | "failed" }>({
      query: arg => {
        const { id, only } = typeof arg === "string" ? { id: arg, only: undefined } : arg;
        return {
          url: ApiEndpoints.CHATBOTS.CHECKUP_RUNS(id),
          method: HttpMethod.POST,
          body: { trigger: "manual", ...(only ? { only } : {}) },
        };
      },
      invalidatesTags: [TAG_TYPES.CHECKUP],
    }),

    // ── The owner's questions (chunk 20d-2) ──

    getCheckupCases: builder.query<{ cases: CheckupCase[] }, string>({
      query: id => ({ url: ApiEndpoints.CHATBOTS.CHECKUP_CASES(id), method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.CHECKUP],
    }),

    addCheckupCase: builder.mutation<CheckupCase, { id: string; input: CheckupCaseInput }>({
      query: ({ id, input }) => ({
        url: ApiEndpoints.CHATBOTS.CHECKUP_CASES(id),
        method: HttpMethod.POST,
        body: input,
      }),
      invalidatesTags: [TAG_TYPES.CHECKUP],
    }),

    editCheckupCase: builder.mutation<
      CheckupCase,
      { id: string; caseId: string; version: string; input: CheckupCaseInput }
    >({
      query: ({ id, caseId, version, input }) => ({
        url: ApiEndpoints.CHATBOTS.CHECKUP_CASE(id, caseId),
        method: HttpMethod.PATCH,
        body: { ...input, version },
      }),
      invalidatesTags: [TAG_TYPES.CHECKUP],
    }),

    removeCheckupCase: builder.mutation<
      { ok: true },
      { id: string; caseId: string; version: string }
    >({
      query: ({ id, caseId, version }) => ({
        url: ApiEndpoints.CHATBOTS.CHECKUP_CASE(id, caseId),
        method: HttpMethod.DELETE,
        body: { version },
      }),
      invalidatesTags: [TAG_TYPES.CHECKUP],
    }),

    restoreCheckupCase: builder.mutation<CheckupCase, { id: string; caseId: string }>({
      query: ({ id, caseId }) => ({
        url: `${ApiEndpoints.CHATBOTS.CHECKUP_CASE(id, caseId)}/restore`,
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.CHECKUP],
    }),

    tryCheckupCase: builder.mutation<
      { result: CheckupResult | null },
      { id: string; caseId: string }
    >({
      query: ({ id, caseId }) => ({
        url: `${ApiEndpoints.CHATBOTS.CHECKUP_CASE(id, caseId)}/try`,
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.CHECKUP],
    }),

    suggestCheckupQuestions: builder.mutation<{ suggestions: CheckupSuggestion[] }, string>({
      query: id => ({
        url: ApiEndpoints.CHATBOTS.CHECKUP_SUGGESTIONS(id),
        method: HttpMethod.POST,
      }),
    }),

    keepCheckupSuggestions: builder.mutation<
      { added: number },
      { id: string; questions: CheckupSuggestion[] }
    >({
      query: ({ id, questions }) => ({
        url: `${ApiEndpoints.CHATBOTS.CHECKUP_SUGGESTIONS(id)}/keep`,
        method: HttpMethod.POST,
        body: { questions },
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
  useGetCheckupCasesQuery,
  useAddCheckupCaseMutation,
  useEditCheckupCaseMutation,
  useRemoveCheckupCaseMutation,
  useRestoreCheckupCaseMutation,
  useTryCheckupCaseMutation,
  useSuggestCheckupQuestionsMutation,
  useKeepCheckupSuggestionsMutation,
} = checkupApi;
