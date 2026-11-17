import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import { DebriefAgentsChangesBody, DebriefAgentsChangesResult, DebriefAgentsConfig } from "@types";

import { baseAPI } from "./baseApi";

/** Debrief Settings › Agents. `url` is read inside each query — suites mock `@constants`. */
export const debriefAgentsAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getDebriefAgentsConfig: builder.query<DebriefAgentsConfig, void>({
      query: () => ({ url: ApiEndpoints.DEBRIEF_AGENTS.CONFIG, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
    createDebriefAgentsChanges: builder.mutation<
      DebriefAgentsChangesResult,
      DebriefAgentsChangesBody
    >({
      query: body => ({
        url: ApiEndpoints.DEBRIEF_AGENTS.CHANGES,
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [TAG_TYPES.DEBRIEF_CONSOLE],
    }),
  }),
});

export const { useGetDebriefAgentsConfigQuery, useCreateDebriefAgentsChangesMutation } =
  debriefAgentsAPI;
