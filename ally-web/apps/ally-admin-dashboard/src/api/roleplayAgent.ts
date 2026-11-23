import { ApiEndpoints, HttpMethod } from "@constants";
import { RoleplayAgentOptions, RoleplayAgentRequest, RoleplayAgentRun } from "@types";

import { baseAPI } from "./baseApi";

/**
 * The roleplay agent on its own: the form's options, starting a run, and polling it. A run
 * builds in the background on the server (a few minutes); the page polls `getRoleplayAgentRun`
 * until it is done or failed.
 */
export const roleplayAgentAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getRoleplayAgentOptions: builder.query<RoleplayAgentOptions, void>({
      query: () => ({ url: ApiEndpoints.ROLEPLAY_AGENT.OPTIONS, method: HttpMethod.GET }),
    }),
    startRoleplayAgentRun: builder.mutation<RoleplayAgentRun, RoleplayAgentRequest>({
      query: body => ({ url: ApiEndpoints.ROLEPLAY_AGENT.RUNS, method: HttpMethod.POST, body }),
    }),
    getRoleplayAgentRun: builder.query<RoleplayAgentRun, string>({
      query: id => ({ url: ApiEndpoints.ROLEPLAY_AGENT.RUN_BY_ID(id), method: HttpMethod.GET }),
    }),
  }),
});

export const {
  useGetRoleplayAgentOptionsQuery,
  useStartRoleplayAgentRunMutation,
  useGetRoleplayAgentRunQuery,
} = roleplayAgentAPI;
