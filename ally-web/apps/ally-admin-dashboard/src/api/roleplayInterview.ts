import { ApiEndpoints, HttpMethod } from "@constants";
import {
  RoleplayInterviewGeneration,
  RoleplayInterviewServerMessage,
  RoleplayInterviewSession,
} from "@types";

import { baseAPI } from "./baseApi";

/**
 * The roleplay interview's non-streaming calls: open (or resume) a session for a roleplay, read it
 * back with its transcript, approve its plan, link it to the saved roleplay, start over. The turn
 * itself streams (useRoleplayInterviewStream).
 */
export const roleplayInterviewAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    openRoleplayInterview: builder.mutation<RoleplayInterviewSession, { scenarioId?: number }>({
      query: body => ({
        url: ApiEndpoints.SIMULATION_STUDIO.ROLEPLAY_INTERVIEW_SESSIONS,
        method: HttpMethod.POST,
        body,
      }),
    }),
    getRoleplayInterview: builder.mutation<
      { session: RoleplayInterviewSession; messages: RoleplayInterviewServerMessage[] },
      string
    >({
      query: id => ({
        url: ApiEndpoints.SIMULATION_STUDIO.ROLEPLAY_INTERVIEW_SESSION(id),
        method: HttpMethod.GET,
      }),
    }),
    approveRoleplayInterview: builder.mutation<
      { session: RoleplayInterviewSession; generation: RoleplayInterviewGeneration },
      { id: string; planVersion: number }
    >({
      query: ({ id, planVersion }) => ({
        url: ApiEndpoints.SIMULATION_STUDIO.ROLEPLAY_INTERVIEW_APPROVE(id),
        method: HttpMethod.POST,
        body: { planVersion },
      }),
    }),
    linkRoleplayInterview: builder.mutation<
      RoleplayInterviewSession,
      { id: string; scenarioId: number }
    >({
      query: ({ id, scenarioId }) => ({
        url: ApiEndpoints.SIMULATION_STUDIO.ROLEPLAY_INTERVIEW_SESSION(id),
        method: HttpMethod.PATCH,
        body: { scenarioId },
      }),
    }),
    /** The roleplay's new character into the Character Library, or the one added before, updated. */
    saveRoleplayInterviewCharacter: builder.mutation<
      RoleplayInterviewSession,
      { id: string; character: Record<string, unknown> }
    >({
      query: ({ id, character }) => ({
        url: ApiEndpoints.SIMULATION_STUDIO.ROLEPLAY_INTERVIEW_CHARACTER(id),
        method: HttpMethod.PUT,
        body: { character },
      }),
    }),
    abandonRoleplayInterview: builder.mutation<RoleplayInterviewSession, string>({
      query: id => ({
        url: ApiEndpoints.SIMULATION_STUDIO.ROLEPLAY_INTERVIEW_ABANDON(id),
        method: HttpMethod.POST,
      }),
    }),
  }),
});

export const {
  useOpenRoleplayInterviewMutation,
  useGetRoleplayInterviewMutation,
  useApproveRoleplayInterviewMutation,
  useLinkRoleplayInterviewMutation,
  useSaveRoleplayInterviewCharacterMutation,
  useAbandonRoleplayInterviewMutation,
} = roleplayInterviewAPI;
