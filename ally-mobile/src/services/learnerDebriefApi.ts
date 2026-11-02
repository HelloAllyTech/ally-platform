import {API_METHODS, API_ROUTES} from '@/constants';
import {DebriefFlagReason, LearnerDebriefView} from '@/types';

import {api} from './api';

/**
 * How often to re-ask while waiting: every 3 s while the Debrief agent
 * writes, for up to 4 minutes, then every 30 s — also while a person
 * finishes a debrief that is "on its way". Mirrors ally-web.
 */
export const LEARNER_DEBRIEF_POLL_MS = 3000;
export const LEARNER_DEBRIEF_SLOW_POLL_MS = 30_000;
export const LEARNER_DEBRIEF_FAST_FOR_MS = 4 * 60_000;

/**
 * The Debrief agent's debrief for one of the learner's own sessions, and the
 * learner's feedback on it. `not_available` (their organisation isn't switched
 * on) means the screen keeps today's debrief.
 */
export const learnerDebriefApi = api.injectEndpoints({
  endpoints: builder => ({
    getLearnerDebrief: builder.query<LearnerDebriefView, string>({
      query: sessionId => ({
        url: API_ROUTES.DEBRIEFS.GET(sessionId),
        method: API_METHODS.GET,
      }),
      providesTags: (_r, _e, sessionId) => [
        {type: 'LearnerDebrief', id: sessionId},
      ],
    }),
    setDebriefHelpful: builder.mutation<
      unknown,
      {sessionId: string; helpful: boolean}
    >({
      query: ({sessionId, helpful}) => ({
        url: API_ROUTES.DEBRIEFS.HELPFUL(sessionId),
        method: API_METHODS.PUT,
        body: {helpful},
      }),
      invalidatesTags: (_r, _e, {sessionId}) => [
        {type: 'LearnerDebrief', id: sessionId},
      ],
    }),
    flagDebriefCard: builder.mutation<
      {id: string; undoUntil: string},
      {
        sessionId: string;
        section: string;
        reason: DebriefFlagReason;
        note?: string;
      }
    >({
      query: ({sessionId, ...body}) => ({
        url: API_ROUTES.DEBRIEFS.FLAGS(sessionId),
        method: API_METHODS.POST,
        body,
      }),
      invalidatesTags: (_r, _e, {sessionId}) => [
        {type: 'LearnerDebrief', id: sessionId},
      ],
    }),
    undoDebriefFlag: builder.mutation<
      unknown,
      {sessionId: string; flagId: string}
    >({
      query: ({sessionId, flagId}) => ({
        url: API_ROUTES.DEBRIEFS.FLAG(sessionId, flagId),
        method: API_METHODS.DELETE,
      }),
      invalidatesTags: (_r, _e, {sessionId}) => [
        {type: 'LearnerDebrief', id: sessionId},
      ],
    }),
    /** The learner read the debrief to the end: earns DEBRIEF_READ XP once. */
    markDebriefRead: builder.mutation<unknown, string>({
      query: sessionId => ({
        url: API_ROUTES.DEBRIEFS.READ(sessionId),
        method: API_METHODS.POST,
      }),
    }),
    /**
     * The learner opened the ready debrief (v9 FR-31): the server records the
     * first time only. 404 (no published debrief) and 403 are fine to ignore.
     */
    markDebriefOpened: builder.mutation<unknown, string>({
      query: sessionId => ({
        url: API_ROUTES.DEBRIEFS.OPENED(sessionId),
        method: API_METHODS.POST,
      }),
    }),
    /** Read-aloud: one card's audio, made on the first request and cached. */
    getDebriefCardAudio: builder.query<
      {url: string; cached: boolean},
      {sessionId: string; section: string}
    >({
      query: ({sessionId, section}) => ({
        url: API_ROUTES.DEBRIEFS.AUDIO(sessionId, section),
        method: API_METHODS.GET,
      }),
      // A signed link lives an hour; re-ask well before it expires.
      keepUnusedDataFor: 30 * 60,
    }),
  }),
});

export const {
  useGetLearnerDebriefQuery,
  useSetDebriefHelpfulMutation,
  useFlagDebriefCardMutation,
  useUndoDebriefFlagMutation,
  useMarkDebriefReadMutation,
  useMarkDebriefOpenedMutation,
  useLazyGetDebriefCardAudioQuery,
} = learnerDebriefApi;
