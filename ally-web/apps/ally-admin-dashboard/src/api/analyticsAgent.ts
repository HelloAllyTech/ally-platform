import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import {
  AnalyticsAgentCatalogResponse,
  AnalyticsAgentConversationDetail,
  AnalyticsAgentConversationSummary,
  AskAnalyticsAgentRequest,
  AskAnalyticsAgentResponse,
  SetAnalyticsAgentFeedbackRequest,
  SetAnalyticsAgentFeedbackResponse,
} from "@types";

import { baseAPI } from "./baseApi";

/**
 * Analytics Agent endpoints.
 *
 * `ask` is a mutation even though it only reads: RTK Query caches queries by
 * argument, and two identical questions asked minutes apart must both run —
 * the second one is a deliberate re-ask against data that may have moved, not a
 * cache hit. A mutation also gives the composer the `isLoading` it needs per
 * send rather than per argument.
 *
 * Every ask saves its turn server-side, so it invalidates the conversation list:
 * the sidebar picks up a new thread (or a bumped one) without the tab having to
 * remember to refetch. A saved conversation's turns are not refetched on ask —
 * the tab already holds them in state, and refetching would replace a live
 * thread with the server's copy mid-conversation.
 */
export const analyticsAgentAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    askAnalyticsAgent: builder.mutation<AskAnalyticsAgentResponse, AskAnalyticsAgentRequest>({
      query: body => ({
        url: ApiEndpoints.ANALYTICS_AGENT.ASK,
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [{ type: TAG_TYPES.ANALYTICS_AGENT_CONVERSATIONS, id: "LIST" }],
    }),

    // Thumbs up / down on one answer. Not tagged and not optimistic here: the
    // thread holds the turns in state and the rating buttons hold their own
    // value, so nothing cached needs refreshing. A reopened conversation is
    // fetched fresh (see below) and so reads the saved rating back.
    setAnalyticsAgentFeedback: builder.mutation<
      SetAnalyticsAgentFeedbackResponse,
      SetAnalyticsAgentFeedbackRequest
    >({
      query: ({ messageId, feedback }) => ({
        url: ApiEndpoints.ANALYTICS_AGENT.MESSAGE_FEEDBACK(messageId),
        method: HttpMethod.PUT,
        body: { feedback },
      }),
    }),

    // The caller's saved conversations, most recently active first.
    getAnalyticsAgentConversations: builder.query<AnalyticsAgentConversationSummary[], void>({
      query: () => ({
        url: ApiEndpoints.ANALYTICS_AGENT.CONVERSATIONS,
        method: HttpMethod.GET,
      }),
      providesTags: [{ type: TAG_TYPES.ANALYTICS_AGENT_CONVERSATIONS, id: "LIST" }],
    }),

    // One conversation with every turn. Not tagged, and fetched through the lazy
    // trigger (which skips the cache): a conversation gains turns as it is used,
    // so reopening one must read it fresh rather than from an earlier fetch.
    getAnalyticsAgentConversation: builder.query<AnalyticsAgentConversationDetail, string>({
      query: id => ({
        url: ApiEndpoints.ANALYTICS_AGENT.CONVERSATION_BY_ID(id),
        method: HttpMethod.GET,
      }),
    }),

    // The readable catalogue, for the "what can I ask about?" panel. Cached
    // normally: it changes on deploy, not per question.
    getAnalyticsAgentCatalog: builder.query<AnalyticsAgentCatalogResponse, void>({
      query: () => ({
        url: ApiEndpoints.ANALYTICS_AGENT.CATALOG,
        method: HttpMethod.GET,
      }),
    }),
  }),
});

export const {
  useAskAnalyticsAgentMutation,
  useGetAnalyticsAgentCatalogQuery,
  useGetAnalyticsAgentConversationsQuery,
  useLazyGetAnalyticsAgentConversationQuery,
  useSetAnalyticsAgentFeedbackMutation,
} = analyticsAgentAPI;
