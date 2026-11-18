import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import { RiskCueOption, RiskCueOptionInput, RiskCueTestResult } from "@types";

import { baseAPI } from "./baseApi";

/**
 * Debrief choices per roleplay (simulation editor) and a clinical advisor's review of risk-cue
 * options. `url` is read inside each query, not at module load — suites mock `@constants`.
 */
export const debriefRoleplayOptionsAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    /** Is the new Debrief on for this roleplay? scenarioId is left out for one not saved yet. */
    getDebriefOptionsAvailability: builder.query<{ enabled: boolean }, { scenarioId?: string }>({
      query: ({ scenarioId }) => ({
        url: ApiEndpoints.DEBRIEF_ROLEPLAY_OPTIONS.AVAILABILITY,
        method: HttpMethod.GET,
        params: scenarioId ? { scenarioId } : undefined,
      }),
    }),
    getRiskCueOptions: builder.query<RiskCueOption[], void>({
      query: () => ({
        url: ApiEndpoints.DEBRIEF_ROLEPLAY_OPTIONS.RISK_CUES,
        method: HttpMethod.GET,
      }),
      providesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    getRiskCueOptionsForReview: builder.query<RiskCueOption[], void>({
      query: () => ({
        url: ApiEndpoints.DEBRIEF_ROLEPLAY_OPTIONS.RISK_CUES_REVIEW,
        method: HttpMethod.GET,
      }),
      providesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    createRiskCueOption: builder.mutation<RiskCueOption, RiskCueOptionInput>({
      query: body => ({
        url: ApiEndpoints.DEBRIEF_ROLEPLAY_OPTIONS.RISK_CUES,
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    updateRiskCueOption: builder.mutation<
      RiskCueOption,
      { id: string; changes: Partial<RiskCueOptionInput> }
    >({
      query: ({ id, changes }) => ({
        url: ApiEndpoints.DEBRIEF_ROLEPLAY_OPTIONS.RISK_CUE(id),
        method: HttpMethod.PATCH,
        body: changes,
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    testRiskCueOption: builder.mutation<RiskCueTestResult, string>({
      query: id => ({
        url: ApiEndpoints.DEBRIEF_ROLEPLAY_OPTIONS.RISK_CUE_ACTION(id, "test"),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    submitRiskCueOption: builder.mutation<RiskCueOption, string>({
      query: id => ({
        url: ApiEndpoints.DEBRIEF_ROLEPLAY_OPTIONS.RISK_CUE_ACTION(id, "submit"),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    reviewTestRiskCueOption: builder.mutation<RiskCueTestResult, string>({
      query: id => ({
        url: ApiEndpoints.DEBRIEF_ROLEPLAY_OPTIONS.RISK_CUE_ACTION(id, "review-test"),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    approveRiskCueOption: builder.mutation<RiskCueOption, { id: string; note?: string }>({
      query: ({ id, note }) => ({
        url: ApiEndpoints.DEBRIEF_ROLEPLAY_OPTIONS.RISK_CUE_ACTION(id, "approve"),
        method: HttpMethod.POST,
        body: note ? { note } : {},
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    rejectRiskCueOption: builder.mutation<RiskCueOption, { id: string; note: string }>({
      query: ({ id, note }) => ({
        url: ApiEndpoints.DEBRIEF_ROLEPLAY_OPTIONS.RISK_CUE_ACTION(id, "reject"),
        method: HttpMethod.POST,
        body: { note },
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    retireRiskCueOption: builder.mutation<RiskCueOption, string>({
      query: id => ({
        url: ApiEndpoints.DEBRIEF_ROLEPLAY_OPTIONS.RISK_CUE_ACTION(id, "retire"),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
  }),
});

export const {
  useGetDebriefOptionsAvailabilityQuery,
  useGetRiskCueOptionsQuery,
  useGetRiskCueOptionsForReviewQuery,
  useCreateRiskCueOptionMutation,
  useUpdateRiskCueOptionMutation,
  useTestRiskCueOptionMutation,
  useSubmitRiskCueOptionMutation,
  useReviewTestRiskCueOptionMutation,
  useApproveRiskCueOptionMutation,
  useRejectRiskCueOptionMutation,
  useRetireRiskCueOptionMutation,
} = debriefRoleplayOptionsAPI;
