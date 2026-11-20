import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import {
  AnalyticsAuditDetail,
  AnalyticsAuditSummary,
  StartAnalyticsAuditRequest,
  StartAnalyticsAuditResponse,
} from "@types";

import { baseAPI } from "./baseApi";

/**
 * Analytics Agent audit endpoints.
 *
 * Starting an audit returns at once — the work runs on the server for minutes —
 * so the tab follows a run by polling it (`getAnalyticsAudit`) and the history
 * list (`getAnalyticsAudits`) while anything is `running`. Both are tagged so a
 * start refreshes the list without the tab having to remember to.
 *
 * `startAnalyticsAudit` is a mutation for the same reason `askAnalyticsAgent` is:
 * two identical starts are two deliberate requests, never one cache hit.
 */
export const analyticsAuditAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    startAnalyticsAudit: builder.mutation<StartAnalyticsAuditResponse, StartAnalyticsAuditRequest>({
      query: body => ({
        url: ApiEndpoints.ANALYTICS_AGENT.AUDITS,
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [{ type: TAG_TYPES.ANALYTICS_AGENT_AUDITS, id: "LIST" }],
    }),

    // Past runs, newest first, without their messages.
    getAnalyticsAudits: builder.query<AnalyticsAuditSummary[], void>({
      query: () => ({
        url: ApiEndpoints.ANALYTICS_AGENT.AUDITS,
        method: HttpMethod.GET,
      }),
      providesTags: [{ type: TAG_TYPES.ANALYTICS_AGENT_AUDITS, id: "LIST" }],
    }),

    // One run with the messages audited so far. Polled while it is running.
    getAnalyticsAudit: builder.query<AnalyticsAuditDetail, string>({
      query: id => ({
        url: ApiEndpoints.ANALYTICS_AGENT.AUDIT_BY_ID(id),
        method: HttpMethod.GET,
      }),
      providesTags: (_result, _error, id) => [{ type: TAG_TYPES.ANALYTICS_AGENT_AUDITS, id }],
    }),
  }),
});

export const {
  useStartAnalyticsAuditMutation,
  useGetAnalyticsAuditsQuery,
  useGetAnalyticsAuditQuery,
} = analyticsAuditAPI;
