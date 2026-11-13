import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import {
  AnalyticsAutomationAgentRun,
  AnalyticsAutomationConfig,
  AnalyticsAutomationRunDetail,
  AnalyticsAutomationRunSummary,
} from "@types";

import { baseAPI } from "./baseApi";

/**
 * Analytics Automation endpoints.
 *
 * Reads only, plus approve / reject on the dbt agent's proposal. There is no
 * start: the scheduler is the only thing that starts a run. The list and the
 * open run are polled by the tab while anything is moving, so approve / reject
 * invalidate both rather than patching the cache — the server is the one that
 * knows what the agent does next.
 */
export const analyticsAutomationAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getAnalyticsAutomationRuns: builder.query<AnalyticsAutomationRunSummary[], void>({
      query: () => ({
        url: ApiEndpoints.ANALYTICS_AGENT.AUTOMATION_RUNS,
        method: HttpMethod.GET,
      }),
      providesTags: [{ type: TAG_TYPES.ANALYTICS_AGENT_AUTOMATION, id: "LIST" }],
    }),

    getAnalyticsAutomationRun: builder.query<AnalyticsAutomationRunDetail, string>({
      query: id => ({
        url: ApiEndpoints.ANALYTICS_AGENT.AUTOMATION_RUN_BY_ID(id),
        method: HttpMethod.GET,
      }),
      providesTags: (_result, _error, id) => [{ type: TAG_TYPES.ANALYTICS_AGENT_AUTOMATION, id }],
    }),

    // Testing aid: whether the server lets a run be started by hand.
    getAnalyticsAutomationConfig: builder.query<AnalyticsAutomationConfig, void>({
      query: () => ({
        url: ApiEndpoints.ANALYTICS_AGENT.AUTOMATION_CONFIG,
        method: HttpMethod.GET,
      }),
    }),

    // Testing aid: start a run now. Returns the new run; the list is refetched.
    startAnalyticsAutomationRun: builder.mutation<AnalyticsAutomationRunDetail, void>({
      query: () => ({
        url: ApiEndpoints.ANALYTICS_AGENT.AUTOMATION_RUNS,
        method: HttpMethod.POST,
      }),
      invalidatesTags: [{ type: TAG_TYPES.ANALYTICS_AGENT_AUTOMATION }],
    }),

    approveAnalyticsAutomationAgent: builder.mutation<AnalyticsAutomationAgentRun, string>({
      query: agentRunId => ({
        url: ApiEndpoints.ANALYTICS_AGENT.AUTOMATION_APPROVE(agentRunId),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [{ type: TAG_TYPES.ANALYTICS_AGENT_AUTOMATION }],
    }),

    rejectAnalyticsAutomationAgent: builder.mutation<AnalyticsAutomationAgentRun, string>({
      query: agentRunId => ({
        url: ApiEndpoints.ANALYTICS_AGENT.AUTOMATION_REJECT(agentRunId),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [{ type: TAG_TYPES.ANALYTICS_AGENT_AUTOMATION }],
    }),
  }),
});

export const {
  useGetAnalyticsAutomationConfigQuery,
  useStartAnalyticsAutomationRunMutation,
  useGetAnalyticsAutomationRunsQuery,
  useGetAnalyticsAutomationRunQuery,
  useApproveAnalyticsAutomationAgentMutation,
  useRejectAnalyticsAutomationAgentMutation,
} = analyticsAutomationAPI;
