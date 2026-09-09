import {API_METHODS, API_ROUTES} from '@/constants';
import {
  EnrollTrackResponse,
  GetLearnTracksResponse,
  GetNextTrackItemResponse,
  GetTrackLanguagesResponse,
  QuizAnswerInput,
  QuizAttemptResult,
  StartTrackItemResponse,
  TrackDetail,
  TrackItemCompletionResult,
  TrackListItem,
  VideoInterjectionAnswerResult,
  VideoProgressResult,
} from '@/types';

import {api} from './api';

const ALL_TRACK_TAGS = [
  'LearnTracks',
  'LearnTrackDetail',
  'LearnTrackNext',
] as const;

/**
 * Track 2.0 learner APIs (multi-component learning courses). Caching
 * strategy mirrors ally-web's `api/tracks.ts`: mutations invalidate
 * detail + list + next EXCEPT `reportVideoProgress`, which fires every
 * ~10s — that one optimistically patches the cached track detail and only
 * invalidates when the response flips `completed: true`. `saveJournalDraft`
 * invalidates nothing — a draft save changes no progress state.
 */
export const coursesApi = api.injectEndpoints({
  endpoints: builder => ({
    getLearnTracks: builder.query<TrackListItem[], void>({
      query: () => ({
        url: API_ROUTES.TRACKS.LIST,
        method: API_METHODS.GET,
      }),
      transformResponse: (response: GetLearnTracksResponse) => response.data,
      providesTags: ['LearnTracks'],
    }),

    getLearnTrackDetail: builder.query<TrackDetail, {trackId: string}>({
      query: ({trackId}) => ({
        url: API_ROUTES.TRACKS.DETAIL(trackId),
        method: API_METHODS.GET,
      }),
      providesTags: ['LearnTrackDetail'],
    }),

    getNextTrackItem: builder.query<
      GetNextTrackItemResponse,
      {trackId: string}
    >({
      query: ({trackId}) => ({
        url: API_ROUTES.TRACKS.NEXT_ITEM(trackId),
        method: API_METHODS.GET,
      }),
      providesTags: ['LearnTrackNext'],
    }),

    enrollTrack: builder.mutation<EnrollTrackResponse, {trackId: string}>({
      query: ({trackId}) => ({
        url: API_ROUTES.TRACKS.ENROLL(trackId),
        method: API_METHODS.POST,
      }),
      invalidatesTags: ALL_TRACK_TAGS,
    }),

    startTrackItem: builder.mutation<StartTrackItemResponse, {itemId: string}>({
      query: ({itemId}) => ({
        url: API_ROUTES.TRACKS.START_ITEM(itemId),
        method: API_METHODS.POST,
      }),
      invalidatesTags: ALL_TRACK_TAGS,
    }),

    markArticleRead: builder.mutation<
      TrackItemCompletionResult,
      {itemId: string}
    >({
      query: ({itemId}) => ({
        url: API_ROUTES.TRACKS.ARTICLE_READ(itemId),
        method: API_METHODS.POST,
      }),
      invalidatesTags: ALL_TRACK_TAGS,
    }),

    reportVideoProgress: builder.mutation<
      VideoProgressResult,
      {itemId: string; trackId: string; watchedPct: number}
    >({
      query: ({itemId, watchedPct}) => ({
        url: API_ROUTES.TRACKS.VIDEO_PROGRESS(itemId),
        method: API_METHODS.POST,
        body: {watchedPct},
      }),
      onQueryStarted: async (
        {itemId, trackId, watchedPct},
        {dispatch, queryFulfilled},
      ) => {
        const patch = dispatch(
          coursesApi.util.updateQueryData(
            'getLearnTrackDetail',
            {trackId},
            draft => {
              for (const section of draft.sections) {
                for (const item of section.items) {
                  if (item.id === itemId) {
                    item.maxWatchedPct = Math.max(
                      item.maxWatchedPct ?? 0,
                      watchedPct,
                    );
                  }
                }
              }
            },
          ),
        );
        try {
          const {data} = await queryFulfilled;
          if (data.completed) {
            dispatch(api.util.invalidateTags([...ALL_TRACK_TAGS]));
          }
        } catch {
          patch.undo();
        }
      },
    }),

    /**
     * Answers a single video interjection (a quiz question embedded at a
     * timestamp inside an s3-hosted video item). One answer per call — not
     * batched like `submitQuizAttempt` — so it invalidates nothing: the
     * interjection's own outcome is tracked locally by the video player,
     * and it carries no track-wide completion result to reconcile.
     */
    submitInterjectionAnswer: builder.mutation<
      VideoInterjectionAnswerResult,
      {itemId: string; interjectionId: string; answer: QuizAnswerInput}
    >({
      query: ({itemId, interjectionId, answer}) => ({
        url: API_ROUTES.TRACKS.INTERJECTION_ANSWER(itemId, interjectionId),
        method: API_METHODS.POST,
        body: answer,
      }),
    }),

    submitQuizAttempt: builder.mutation<
      QuizAttemptResult,
      {itemId: string; answers: QuizAnswerInput[]}
    >({
      query: ({itemId, answers}) => ({
        url: API_ROUTES.TRACKS.QUIZ_ATTEMPTS(itemId),
        method: API_METHODS.POST,
        body: {answers},
      }),
      invalidatesTags: ALL_TRACK_TAGS,
    }),

    regradeQuizAttempt: builder.mutation<
      QuizAttemptResult,
      {itemId: string; attemptId: string}
    >({
      query: ({itemId, attemptId}) => ({
        url: API_ROUTES.TRACKS.QUIZ_REGRADE(itemId, attemptId),
        method: API_METHODS.POST,
      }),
      invalidatesTags: ALL_TRACK_TAGS,
    }),

    /**
     * Personal best for a game run. A game item is already complete by the
     * time this fires, so it unlocks nothing and invalidates nothing — the
     * player treats a failure as a non-event.
     */
    recordGameResult: builder.mutation<
      {bestScore: number; playCount: number; score: number},
      {itemId: string; score: number}
    >({
      query: ({itemId, score}) => ({
        url: API_ROUTES.TRACKS.GAME_RESULT(itemId),
        method: API_METHODS.POST,
        body: {score},
      }),
    }),

    saveJournalDraft: builder.mutation<
      {success: boolean},
      {itemId: string; responses: {promptId: string; response: string}[]}
    >({
      query: ({itemId, responses}) => ({
        url: API_ROUTES.TRACKS.JOURNAL_DRAFT(itemId),
        method: API_METHODS.POST,
        body: {responses},
      }),
    }),

    submitJournal: builder.mutation<
      TrackItemCompletionResult,
      {itemId: string}
    >({
      query: ({itemId}) => ({
        url: API_ROUTES.TRACKS.JOURNAL_SUBMIT(itemId),
        method: API_METHODS.POST,
      }),
      invalidatesTags: ALL_TRACK_TAGS,
    }),

    getTrackLanguages: builder.query<
      GetTrackLanguagesResponse,
      {trackId: string}
    >({
      query: ({trackId}) => ({
        url: API_ROUTES.TRACKS.LANGUAGES(trackId),
        method: API_METHODS.GET,
      }),
      providesTags: ['LearnTrackLanguages'],
    }),

    /**
     * Persists the learner's language for this course. Invalidates the whole
     * track cache: every title, prompt and option in the detail and next-item
     * payloads changes with it.
     */
    setTrackLanguage: builder.mutation<
      {languageCode: string},
      {trackId: string; languageCode: string}
    >({
      query: ({trackId, languageCode}) => ({
        url: API_ROUTES.TRACKS.SET_LANGUAGE(trackId),
        method: API_METHODS.PUT,
        body: {languageCode},
      }),
      invalidatesTags: [...ALL_TRACK_TAGS, 'LearnTrackLanguages'],
    }),
  }),
});

export const {
  useGetLearnTracksQuery,
  useGetLearnTrackDetailQuery,
  useGetNextTrackItemQuery,
  useLazyGetNextTrackItemQuery,
  useEnrollTrackMutation,
  useStartTrackItemMutation,
  useMarkArticleReadMutation,
  useReportVideoProgressMutation,
  useSubmitInterjectionAnswerMutation,
  useSubmitQuizAttemptMutation,
  useRegradeQuizAttemptMutation,
  useSaveJournalDraftMutation,
  useSubmitJournalMutation,
  useRecordGameResultMutation,
  useGetTrackLanguagesQuery,
  useSetTrackLanguageMutation,
} = coursesApi;
