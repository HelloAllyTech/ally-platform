import { ApiEndpoints, HttpMethod } from "@constants";

import { baseAPI } from "./baseApi";

/**
 * Whether the new Debrief is on for a roleplay (the simulation editor shows its Debrief risk-cue
 * question only then). `url` is read inside the query, not at module load — suites mock `@constants`.
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
  }),
});

export const { useGetDebriefOptionsAvailabilityQuery } = debriefRoleplayOptionsAPI;
