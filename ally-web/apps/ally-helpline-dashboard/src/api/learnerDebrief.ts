import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import { DebriefFlagReason, LearnerDebriefView, SupervisorDebriefView } from "@types";

import { baseAPI } from "./baseAPI";

/**
 * How often to re-ask while waiting (v9 FR-33): every 3 s while the Debrief
 * agent writes, for up to 4 minutes, then every 30 s — also while a person
 * finishes a debrief that is "on its way".
 */
export const LEARNER_DEBRIEF_POLL_MS = 3000;
export const LEARNER_DEBRIEF_SLOW_POLL_MS = 30_000;
export const LEARNER_DEBRIEF_FAST_FOR_MS = 4 * 60_000;

const learnerDebriefAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    /**
     * The new Debrief agent's debrief for one of the caller's own sessions.
     * Poll it with `pollingInterval` only while `state === "working"` — see
     * `components/debrief-tab/useLearnerDebrief.ts`.
     */
    getLearnerDebrief: builder.query<LearnerDebriefView, string>({
      query: sessionId => ({
        url: ApiEndpoints.DEBRIEFS.GET_LEARNER_DEBRIEF(sessionId),
        method: HttpMethod.GET,
      }),
      providesTags: (_r, _e, sessionId) => [{ type: TAG_TYPES.LEARNER_DEBRIEF, id: sessionId }],
    }),
    /** "Was this helpful?" — one answer per debrief; answering again changes it. */
    setDebriefHelpful: builder.mutation<unknown, { sessionId: string; helpful: boolean }>({
      query: ({ sessionId, helpful }) => ({
        url: ApiEndpoints.DEBRIEFS.HELPFUL(sessionId),
        method: HttpMethod.PUT,
        body: { helpful },
      }),
      invalidatesTags: (_r, _e, { sessionId }) => [
        { type: TAG_TYPES.LEARNER_DEBRIEF, id: sessionId },
      ],
    }),
    /** "This isn't right" on one card. */
    flagDebriefCard: builder.mutation<
      { id: string; undoUntil: string },
      { sessionId: string; section: string; reason: DebriefFlagReason; note?: string }
    >({
      query: ({ sessionId, ...body }) => ({
        url: ApiEndpoints.DEBRIEFS.FLAGS(sessionId),
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: (_r, _e, { sessionId }) => [
        { type: TAG_TYPES.LEARNER_DEBRIEF, id: sessionId },
      ],
    }),
    undoDebriefFlag: builder.mutation<unknown, { sessionId: string; flagId: string }>({
      query: ({ sessionId, flagId }) => ({
        url: ApiEndpoints.DEBRIEFS.FLAG(sessionId, flagId),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: (_r, _e, { sessionId }) => [
        { type: TAG_TYPES.LEARNER_DEBRIEF, id: sessionId },
      ],
    }),
    /** A supervisor's read-only view of a learner's debrief (Roleplay Logs). */
    getSupervisorDebrief: builder.query<SupervisorDebriefView, string>({
      query: sessionId => ({
        url: ApiEndpoints.DEBRIEFS.SUPERVISOR(sessionId),
        method: HttpMethod.GET,
      }),
    }),
    /** The learner read the debrief to the end: earns DEBRIEF_READ XP once. */
    markDebriefRead: builder.mutation<unknown, string>({
      query: sessionId => ({
        url: ApiEndpoints.DEBRIEFS.READ(sessionId),
        method: HttpMethod.POST,
      }),
    }),
    /** v9 FR-31: the ready debrief was on screen for 2 s; recorded once. */
    markDebriefOpened: builder.mutation<unknown, string>({
      query: sessionId => ({
        url: ApiEndpoints.DEBRIEFS.OPENED(sessionId),
        method: HttpMethod.POST,
      }),
    }),
    /** Read-aloud: one card's audio, made on the first request and cached. */
    getDebriefCardAudio: builder.query<
      { url: string; cached: boolean },
      { sessionId: string; section: string }
    >({
      query: ({ sessionId, section }) => ({
        url: ApiEndpoints.DEBRIEFS.AUDIO(sessionId, section),
        method: HttpMethod.GET,
      }),
      // A signed link lives an hour; re-ask well before it expires.
      keepUnusedDataFor: 30 * 60,
    }),
  }),
});

export const {
  useGetSupervisorDebriefQuery,
  useLazyGetDebriefCardAudioQuery,
  useMarkDebriefReadMutation,
  useMarkDebriefOpenedMutation,
  useGetLearnerDebriefQuery,
  useSetDebriefHelpfulMutation,
  useFlagDebriefCardMutation,
  useUndoDebriefFlagMutation,
} = learnerDebriefAPI;
