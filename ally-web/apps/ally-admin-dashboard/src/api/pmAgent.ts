import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import {
  PmAgentStateResponse,
  PmAnswerInput,
  PmCard,
  PmCardsResponse,
  PmFeedbackInput,
  PmHealth,
  PmMemoryFact,
  PmMemoryResponse,
  PmReasonChip,
  PmRejectInput,
  PmRun,
  PmRunNowResponse,
  PmSettings,
  PmSettingsPatch,
  PmTrackingResponse,
} from "@types";

import { baseAPI } from "./baseApi";

/** Statuses the Review queue loads: open cards plus the ones that need a person. */
export const PM_REVIEW_STATUSES = "open,failed,needs_attention,merged_not_released";

const CARD_TAGS = [TAG_TYPES.PM_AGENT_CARDS, TAG_TYPES.PM_AGENT_STATE, TAG_TYPES.PM_AGENT_TRACKING];

/**
 * PM Agent endpoints (ally-be `docs/pm-agent.md`). Decisions are optimistic in the page (it hides
 * the card at once and restores it on error), so the mutations here only invalidate.
 */
export const pmAgentAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getPmAgentFeedState: builder.query<PmAgentStateResponse, void>({
      query: () => ({ url: ApiEndpoints.PM_AGENT.STATE, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.PM_AGENT_STATE],
    }),

    getPmAgentCards: builder.query<PmCardsResponse, { status?: string } | void>({
      query: arg => ({
        url: ApiEndpoints.PM_AGENT.CARDS,
        method: HttpMethod.GET,
        params: { status: (arg && arg.status) || PM_REVIEW_STATUSES },
      }),
      providesTags: [TAG_TYPES.PM_AGENT_CARDS],
    }),

    getPmAgentCard: builder.query<PmCard, string>({
      query: id => ({ url: ApiEndpoints.PM_AGENT.CARD(id), method: HttpMethod.GET }),
    }),

    acceptPmAgentCard: builder.mutation<PmCard, { id: string; path: "builder" | "download" }>({
      query: ({ id, path }) => ({
        url: ApiEndpoints.PM_AGENT.ACCEPT(id),
        method: HttpMethod.POST,
        body: { path },
      }),
      invalidatesTags: CARD_TAGS,
    }),

    undoPmAgentCard: builder.mutation<PmCard, string>({
      query: id => ({ url: ApiEndpoints.PM_AGENT.UNDO(id), method: HttpMethod.POST }),
      invalidatesTags: CARD_TAGS,
    }),

    rejectPmAgentCard: builder.mutation<PmCard, PmRejectInput>({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.PM_AGENT.REJECT(id),
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [
        TAG_TYPES.PM_AGENT_CARDS,
        TAG_TYPES.PM_AGENT_STATE,
        TAG_TYPES.PM_AGENT_HISTORY,
      ],
    }),

    /** Add or replace the reason after a reject (within 30 s). */
    reasonPmAgentCard: builder.mutation<
      PmCard,
      { id: string; reasonChip?: PmReasonChip; reason?: string }
    >({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.PM_AGENT.REASON(id),
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [TAG_TYPES.PM_AGENT_HISTORY],
    }),

    feedbackPmAgentCard: builder.mutation<PmCard, PmFeedbackInput>({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.PM_AGENT.FEEDBACK(id),
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [...CARD_TAGS, TAG_TYPES.PM_AGENT_HISTORY],
    }),

    answerPmAgentCard: builder.mutation<PmCard, PmAnswerInput>({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.PM_AGENT.ANSWER(id),
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [...CARD_TAGS, TAG_TYPES.PM_AGENT_MEMORY, TAG_TYPES.PM_AGENT_HISTORY],
    }),

    skipPmAgentCard: builder.mutation<PmCard, string>({
      query: id => ({ url: ApiEndpoints.PM_AGENT.SKIP(id), method: HttpMethod.POST }),
      invalidatesTags: [...CARD_TAGS, TAG_TYPES.PM_AGENT_HISTORY],
    }),

    retryPmAgentCard: builder.mutation<PmCard, string>({
      query: id => ({ url: ApiEndpoints.PM_AGENT.RETRY(id), method: HttpMethod.POST }),
      invalidatesTags: CARD_TAGS,
    }),

    dismissPmAgentCard: builder.mutation<PmCard, string>({
      query: id => ({ url: ApiEndpoints.PM_AGENT.DISMISS(id), method: HttpMethod.POST }),
      invalidatesTags: CARD_TAGS,
    }),

    /** The compiled plan as text, for Download plan.md. */
    getPmAgentPlanMd: builder.query<string, string>({
      query: id => ({
        url: ApiEndpoints.PM_AGENT.PLAN_MD(id),
        method: HttpMethod.GET,
        responseHandler: "text",
      }),
      keepUnusedDataFor: 0,
    }),

    getPmAgentTracking: builder.query<PmTrackingResponse, void>({
      query: () => ({ url: ApiEndpoints.PM_AGENT.TRACKING, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.PM_AGENT_TRACKING],
    }),

    runPmAgentNow: builder.mutation<PmRunNowResponse, void>({
      query: () => ({ url: ApiEndpoints.PM_AGENT.RUN, method: HttpMethod.POST }),
      invalidatesTags: [TAG_TYPES.PM_AGENT_STATE, TAG_TYPES.PM_AGENT_CARDS],
    }),

    getPmAgentRuns: builder.query<{ runs: PmRun[] }, { limit?: number } | void>({
      query: arg => ({
        url: ApiEndpoints.PM_AGENT.RUNS,
        method: HttpMethod.GET,
        params: arg && arg.limit ? { limit: arg.limit } : {},
      }),
      providesTags: [TAG_TYPES.PM_AGENT_STATE],
    }),

    getPmAgentSettings: builder.query<PmSettings, void>({
      query: () => ({ url: ApiEndpoints.PM_AGENT.SETTINGS, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.PM_AGENT_SETTINGS],
    }),

    updatePmAgentSettings: builder.mutation<PmSettings, PmSettingsPatch>({
      query: body => ({ url: ApiEndpoints.PM_AGENT.SETTINGS, method: HttpMethod.PATCH, body }),
      invalidatesTags: [TAG_TYPES.PM_AGENT_SETTINGS, TAG_TYPES.PM_AGENT_STATE],
    }),

    getPmAgentMemory: builder.query<PmMemoryResponse, void>({
      query: () => ({ url: ApiEndpoints.PM_AGENT.MEMORY, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.PM_AGENT_MEMORY],
    }),

    updatePmAgentMemory: builder.mutation<
      PmMemoryFact,
      { id: string; value?: string; active?: boolean }
    >({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.PM_AGENT.MEMORY_BY_ID(id),
        method: HttpMethod.PATCH,
        body,
      }),
      invalidatesTags: [TAG_TYPES.PM_AGENT_MEMORY],
    }),

    deletePmAgentMemory: builder.mutation<PmMemoryFact, string>({
      query: id => ({ url: ApiEndpoints.PM_AGENT.MEMORY_BY_ID(id), method: HttpMethod.DELETE }),
      invalidatesTags: [TAG_TYPES.PM_AGENT_MEMORY],
    }),

    getPmAgentHistory: builder.query<{ cards: PmCard[] }, { limit?: number } | void>({
      query: arg => ({
        url: ApiEndpoints.PM_AGENT.HISTORY,
        method: HttpMethod.GET,
        params: arg && arg.limit ? { limit: arg.limit } : {},
      }),
      providesTags: [TAG_TYPES.PM_AGENT_HISTORY],
    }),

    getPmAgentHealth: builder.query<PmHealth, void>({
      query: () => ({ url: ApiEndpoints.PM_AGENT.HEALTH, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.PM_AGENT_HEALTH],
    }),
  }),
});

export const {
  useGetPmAgentFeedStateQuery,
  useGetPmAgentCardsQuery,
  useGetPmAgentCardQuery,
  useAcceptPmAgentCardMutation,
  useUndoPmAgentCardMutation,
  useRejectPmAgentCardMutation,
  useReasonPmAgentCardMutation,
  useFeedbackPmAgentCardMutation,
  useAnswerPmAgentCardMutation,
  useSkipPmAgentCardMutation,
  useRetryPmAgentCardMutation,
  useDismissPmAgentCardMutation,
  useLazyGetPmAgentPlanMdQuery,
  useGetPmAgentTrackingQuery,
  useRunPmAgentNowMutation,
  useGetPmAgentRunsQuery,
  useGetPmAgentSettingsQuery,
  useUpdatePmAgentSettingsMutation,
  useGetPmAgentMemoryQuery,
  useUpdatePmAgentMemoryMutation,
  useDeletePmAgentMemoryMutation,
  useGetPmAgentHistoryQuery,
  useGetPmAgentHealthQuery,
} = pmAgentAPI;
