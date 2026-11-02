import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import { DebriefFlagReason, LearnerDebriefView } from "@types";

import { baseAPI } from "./baseAPI";

/** How often to re-ask while the Debrief agent is still writing. */
export const LEARNER_DEBRIEF_POLL_MS = 5000;

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
    /** The learner read the debrief to the end: earns DEBRIEF_READ XP once. */
    markDebriefRead: builder.mutation<unknown, string>({
      query: sessionId => ({
        url: ApiEndpoints.DEBRIEFS.READ(sessionId),
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
  useLazyGetDebriefCardAudioQuery,
  useMarkDebriefReadMutation,
  useGetLearnerDebriefQuery,
  useSetDebriefHelpfulMutation,
  useFlagDebriefCardMutation,
  useUndoDebriefFlagMutation,
} = learnerDebriefAPI;
