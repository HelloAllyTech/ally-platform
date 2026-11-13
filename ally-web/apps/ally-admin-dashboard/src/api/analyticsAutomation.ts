import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import {
  AnalyticsAutomationAgentRun,
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
  useGetAnalyticsAutomationRunsQuery,
  useGetAnalyticsAutomationRunQuery,
  useApproveAnalyticsAutomationAgentMutation,
  useRejectAnalyticsAutomationAgentMutation,
} = analyticsAutomationAPI;
