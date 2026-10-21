import {API_METHODS, API_ROUTES} from '@/constants';
import {
  BranchingResult,
  BucketSortPlacementResult,
  EnrollTrackResponse,
  GetLearnTracksResponse,
  GetNextTrackItemResponse,
  GetTrackLanguagesResponse,
  QuizAnswerInput,
  QuizAttemptResult,
  StartTrackItemResponse,
  SubmitArticleQuestionAnswerResult,
  TrackDetail,
  TrackItemCompletionResult,
  TrackListItem,
  TrackProgressDashboard,
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

    /**
     * Progress + consolidated feedback dashboard: percent complete plus
     * skill-category feedback aggregated across every evaluated roleplay
     * session in the course. Shares the track-detail tag — it goes stale on
     * exactly the same completion mutations that already invalidate it.
     */
    getLearnTrackProgress: builder.query<
      TrackProgressDashboard,
      {trackId: string}
    >({
      query: ({trackId}) => ({
        url: API_ROUTES.TRACKS.PROGRESS(trackId),
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

    /**
     * Answers one inline article question. Final — the server refuses a
     * second answer to the same question. Invalidates the track tags only
     * when the answer completed the article, which is the one case where the
     * outline's completion state has actually moved; answering mid-article
     * moves nothing it shows, and this fires on every question.
     */
    submitArticleQuestionAnswer: builder.mutation<
      SubmitArticleQuestionAnswerResult,
      {itemId: string; questionId: string; selectedOptionId: string}
    >({
      query: ({itemId, questionId, selectedOptionId}) => ({
        url: API_ROUTES.TRACKS.ARTICLE_QUESTION_ANSWER(itemId, questionId),
        method: API_METHODS.POST,
        body: {selectedOptionId},
      }),
      onQueryStarted: async (_arg, {dispatch, queryFulfilled}) => {
        const {data} = await queryFulfilled;
        if (data.completion?.completed) {
          dispatch(api.util.invalidateTags([...ALL_TRACK_TAGS]));
        }
      },
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

    /**
     * Finished run of a branching scenario. The server walks the path and
     * decides the score; the response is what the player shows.
     */
    recordBranchingResult: builder.mutation<
      BranchingResult,
      {itemId: string; path: string[]}
    >({
      query: ({itemId, path}) => ({
        url: API_ROUTES.TRACKS.BRANCHING_RESULT(itemId),
        method: API_METHODS.POST,
        body: {path},
      }),
      invalidatesTags: ALL_TRACK_TAGS,
    }),

    /**
     * One placement in a bucket sort. The server holds the key; the response
     * is that item's verdict, the right bucket and the author's explanation.
     */
    placeBucketSortItem: builder.mutation<
      BucketSortPlacementResult,
      {itemId: string; sortItemId: string; bucketId: string}
    >({
      query: ({itemId, sortItemId, bucketId}) => ({
        url: API_ROUTES.TRACKS.BUCKET_SORT_PLACE(itemId),
        method: API_METHODS.POST,
        body: {sortItemId, bucketId},
      }),
      invalidatesTags: ALL_TRACK_TAGS,
    }),

    /** Another round of a finished bucket sort. */
    restartBucketSort: builder.mutation<{success: boolean}, {itemId: string}>({
      query: ({itemId}) => ({
        url: API_ROUTES.TRACKS.BUCKET_SORT_RESTART(itemId),
        method: API_METHODS.POST,
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
  useGetLearnTrackProgressQuery,
  useGetNextTrackItemQuery,
  useLazyGetNextTrackItemQuery,
  useEnrollTrackMutation,
  useStartTrackItemMutation,
  useMarkArticleReadMutation,
  useSubmitArticleQuestionAnswerMutation,
  useReportVideoProgressMutation,
  useSubmitInterjectionAnswerMutation,
  useSubmitQuizAttemptMutation,
  useRegradeQuizAttemptMutation,
  useSaveJournalDraftMutation,
  useSubmitJournalMutation,
  useRecordGameResultMutation,
  useRecordBranchingResultMutation,
  usePlaceBucketSortItemMutation,
  useRestartBucketSortMutation,
  useGetTrackLanguagesQuery,
  useSetTrackLanguageMutation,
} = coursesApi;
