import {API_METHODS, API_ROUTES} from '@/constants';
import {DebriefFlagReason, LearnerDebriefView} from '@/types';

import {api} from './api';

/** How often to ask again while the Debrief agent is still writing. */
export const LEARNER_DEBRIEF_POLL_MS = 5000;

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
  }),
});

export const {
  useGetLearnerDebriefQuery,
  useSetDebriefHelpfulMutation,
  useFlagDebriefCardMutation,
  useUndoDebriefFlagMutation,
} = learnerDebriefApi;
