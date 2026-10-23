import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import type { ValidatedAgentTurnsSettings } from "@types";

import { baseAPI } from "./baseApi";

/**
 * The validated-turn switches for Course Copilot and the character interview — one
 * `global_settings` row in ally-be, read per turn. Builder's own switch is
 * `builder_settings.validatedTurns` (api/builder.ts).
 */
export const validatedAgentTurnsAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getValidatedAgentTurns: builder.query<ValidatedAgentTurnsSettings, void>({
      query: () => ({
        url: ApiEndpoints.SETTINGS.VALIDATED_AGENT_TURNS,
        method: HttpMethod.GET,
      }),
      providesTags: [TAG_TYPES.VALIDATED_AGENT_TURNS],
    }),
    // Either switch left out keeps its current value.
    updateValidatedAgentTurns: builder.mutation<
      ValidatedAgentTurnsSettings,
      Partial<ValidatedAgentTurnsSettings>
    >({
      query: body => ({
        url: ApiEndpoints.SETTINGS.VALIDATED_AGENT_TURNS,
        method: HttpMethod.PATCH,
        body,
      }),
      invalidatesTags: [TAG_TYPES.VALIDATED_AGENT_TURNS],
    }),
  }),
});

export const { useGetValidatedAgentTurnsQuery, useUpdateValidatedAgentTurnsMutation } =
  validatedAgentTurnsAPI;
