import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import 'course_models.dart';
import 'quiz_models.dart';
import 'start_item_payload.dart';

/// Ported from ally-mobile (React Native)'s `src/services/coursesApi.ts` —
/// same routes (`src/constants/general.ts`'s `API_ROUTES.TRACKS`), same
/// backend contract. RTK Query's `ALL_TRACK_TAGS` invalidation is
/// replicated through [_invalidateTracks] (wired by the provider to
/// `ref.invalidate` of the list, detail and progress providers): the same
/// mutations, and the same conditional ones (article question / video
/// progress only once they complete the item).
///
/// Scope: ARTICLE, VIDEO, QUIZ (all 8 question types), JOURNAL, GAME,
/// BRANCHING_SCENARIO, and BUCKET_SORT items end-to-end.
class CoursesRepository {
  CoursesRepository(this._dio, {void Function()? onInvalidateTracks})
      : _onInvalidateTracks = onInvalidateTracks;

  final Dio _dio;

  /// RN `ALL_TRACK_TAGS` (`LearnTracks`, `LearnTrackDetail`, `LearnTrackNext`).
  final void Function()? _onInvalidateTracks;

  void _invalidateTracks() => _onInvalidateTracks?.call();

  Future<List<TrackListItem>> getLearnTracks() async {
    final response = await _dio.get<Map<String, dynamic>>('/learn/tracks');
    final data = response.data?['data'] as List<dynamic>? ?? [];
    return data
        .map((e) => TrackListItem.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<TrackDetail> getLearnTrackDetail(String trackId) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/learn/tracks/$trackId',
    );
    return TrackDetail.fromJson(response.data!);
  }

  /// The real "what should Start/Continue open next" source of truth —
  /// server-side rules (section gating, retry cooldowns) that a client-side
  /// scan of an already-fetched `TrackDetail`'s item statuses can't fully
  /// replicate. Mirrors ally-mobile (React Native)'s
  /// `useLazyGetNextTrackItemQuery` (`GET /learn/tracks/:trackId/next-item`).
  Future<GetNextTrackItemResponse> getNextTrackItem(String trackId) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/learn/tracks/$trackId/next-item',
    );
    return GetNextTrackItemResponse.fromJson(response.data!);
  }

  /// Switches which language this course is read in for the current
  /// learner — mirrors ally-mobile (React Native)'s `useSetTrackLanguage
  /// Mutation` (`PUT /learn/tracks/:trackId/language`). The whole track
  /// cache changes with it (every title, prompt and option in the detail
  /// and next-item payloads), so callers should re-fetch
  /// `getLearnTrackDetail` after this resolves.
  Future<void> setTrackLanguage({
    required String trackId,
    required String languageCode,
  }) async {
    await _dio.put<void>(
      '/learn/tracks/$trackId/language',
      data: {'languageCode': languageCode},
    );
    _invalidateTracks();
  }

  /// RN `getTrackLanguages` (`GET /learn/tracks/:trackId/languages`): the
  /// languages a track can be read in. No RN screen calls it (the language
  /// sheet reads them off the track detail); ported for API parity.
  Future<({List<TrackLanguageOption> languages, String? selectedLanguageCode})> getTrackLanguages(
    String trackId,
  ) async {
    final response = await _dio.get<Map<String, dynamic>>('/learn/tracks/$trackId/languages');
    final data = response.data ?? const <String, dynamic>{};
    return (
      languages: (data['languages'] as List<dynamic>? ?? const [])
          .map((e) => TrackLanguageOption.fromJson(e as Map<String, dynamic>))
          .toList(),
      selectedLanguageCode: data['selectedLanguageCode'] as String?,
    );
  }

  Future<TrackProgressDashboard> getLearnTrackProgress(String trackId) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/learn/tracks/$trackId/progress',
    );
    return TrackProgressDashboard.fromJson(response.data!);
  }

  Future<void> enrollTrack(String trackId) async {
    await _dio.post<void>('/learn/tracks/$trackId/enroll');
    _invalidateTracks();
  }

  /// Returns the real per-type content payload (quiz questions, article
  /// HTML + inline questions, video URL + interjections) — same
  /// discriminated-union contract as RN's `StartTrackItemResponse`.
  Future<StartItemPayload> startTrackItem(String itemId) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/learn/tracks/items/$itemId/start',
    );
    _invalidateTracks();
    return StartItemPayload.fromJson(response.data!);
  }

  Future<TrackItemCompletionResult> markArticleRead(String itemId) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/learn/tracks/items/$itemId/article-read',
    );
    _invalidateTracks();
    return TrackItemCompletionResult.fromJson(response.data ?? {});
  }

  /// Fires via [VideoWatchProgressTracker]'s own throttling (every ~10s or
  /// a +10% jump), matching the RN screen's own cadence comment in
  /// `coursesApi.ts`. The response's `completed` flips once the server's
  /// `requiredWatchPct` threshold is crossed — server-side monotonic max,
  /// so a dropped report is recovered by the next one.
  Future<
    ({
      bool completed,
      double maxWatchedPct,
      bool sectionCompleted,
      bool trackCompleted,
    })
  >
  reportVideoProgress({
    required String itemId,
    required double watchedPct,
  }) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/learn/tracks/items/$itemId/video-progress',
      data: {'watchedPct': watchedPct},
    );
    // RN patches the cache every ~10s and only invalidates on completion.
    if (response.data?['completed'] == true) _invalidateTracks();
    return (
      completed: response.data?['completed'] as bool? ?? false,
      maxWatchedPct:
          (response.data?['maxWatchedPct'] as num?)?.toDouble() ?? watchedPct,
      sectionCompleted: response.data?['sectionCompleted'] as bool? ?? false,
      trackCompleted: response.data?['trackCompleted'] as bool? ?? false,
    );
  }

  /// RN `submitArticleQuestionAnswer`; the last answer completes the item.
  Future<ArticleQuestionAnswerResult> submitArticleQuestionAnswer({
    required String itemId,
    required String questionId,
    required String selectedOptionId,
  }) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/learn/tracks/items/$itemId/article-questions/$questionId/answer',
      data: {'selectedOptionId': selectedOptionId},
    );
    final result = ArticleQuestionAnswerResult.fromJson(response.data!);
    if (result.completion?.completed == true) _invalidateTracks();
    return result;
  }

  Future<({bool? correct, int pointsAwarded, int pointsPossible})>
  submitInterjectionAnswer({
    required String itemId,
    required String interjectionId,
    required QuizAnswerInput answer,
  }) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/learn/tracks/items/$itemId/interjections/$interjectionId/answer',
      data: answer.toJson(),
    );
    final grading = response.data!['grading'] as Map<String, dynamic>;
    return (
      correct: response.data!['correct'] as bool?,
      pointsAwarded: (grading['pointsAwarded'] as num?)?.toInt() ?? 0,
      pointsPossible: (grading['pointsPossible'] as num?)?.toInt() ?? 0,
    );
  }

  Future<QuizAttemptResult> submitQuizAttempt({
    required String itemId,
    required List<QuizAnswerInput> answers,
  }) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/learn/tracks/items/$itemId/quiz-attempts',
      data: {'answers': answers.map((a) => a.toJson()).toList()},
    );
    _invalidateTracks();
    return QuizAttemptResult.fromJson(response.data!);
  }

  /// RN `regradeQuizAttempt` — retries LLM grading of a PENDING_GRADING
  /// attempt (`POST …/quiz-attempts/:attemptId/regrade`).
  Future<QuizAttemptResult> regradeQuizAttempt({
    required String itemId,
    required String attemptId,
  }) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/learn/tracks/items/$itemId/quiz-attempts/$attemptId/regrade',
    );
    _invalidateTracks();
    return QuizAttemptResult.fromJson(response.data!);
  }

  Future<void> saveJournalDraft({
    required String itemId,
    required List<({String promptId, String response})> responses,
  }) async {
    await _dio.post<void>(
      '/learn/tracks/items/$itemId/journal',
      data: {
        'responses': [
          for (final r in responses)
            {'promptId': r.promptId, 'response': r.response},
        ],
      },
    );
  }

  Future<TrackItemCompletionResult> submitJournal(String itemId) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/learn/tracks/items/$itemId/journal/submit',
    );
    _invalidateTracks();
    return TrackItemCompletionResult.fromJson(response.data ?? {});
  }

  /// A game item is already complete server-side by the time this fires
  /// (the server marks it done the moment it's opened) — this just records
  /// a personal-best run, same as the RN screen's own doc comment.
  Future<int> recordGameResult({
    required String itemId,
    required int score,
  }) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/learn/tracks/items/$itemId/game-result',
      data: {'score': score},
    );
    return (response.data?['bestScore'] as num?)?.toInt() ?? score;
  }

  /// Submits the finished path of a branching-scenario run; the server owns
  /// scoring and is the only truth (the whole graph ships client-side and
  /// is walked locally, but nothing is scored until this call).
  Future<BranchingResult> recordBranchingResult({
    required String itemId,
    required List<String> path,
  }) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/learn/tracks/items/$itemId/branching-result',
      data: {'path': path},
    );
    _invalidateTracks();
    return BranchingResult.fromJson(response.data!);
  }

  /// One placement in a bucket sort. The server holds the key; the response
  /// is that item's verdict, the right bucket and the author's explanation.
  Future<BucketSortPlacementResult> placeBucketSortItem({
    required String itemId,
    required String sortItemId,
    required String bucketId,
  }) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/learn/tracks/items/$itemId/bucket-sort/place',
      data: {'sortItemId': sortItemId, 'bucketId': bucketId},
    );
    _invalidateTracks();
    return BucketSortPlacementResult.fromJson(response.data!);
  }

  /// Another round of a finished bucket sort.
  Future<void> restartBucketSort(String itemId) async {
    await _dio.post<void>('/learn/tracks/items/$itemId/bucket-sort/restart');
  }
}

final Provider<CoursesRepository> coursesRepositoryProvider = Provider<CoursesRepository>((ref) {
  return CoursesRepository(
    ref.watch(apiClientProvider),
    // `LearnTrackDetail` also tags `getLearnTrackProgress` in RN.
    onInvalidateTracks: () {
      ref.invalidate(learnTracksProvider);
      ref.invalidate(trackDetailProvider);
      ref.invalidate(trackProgressProvider);
    },
  );
});

final learnTracksProvider = FutureProvider<List<TrackListItem>>((ref) {
  return ref.watch(coursesRepositoryProvider).getLearnTracks();
});

final trackDetailProvider = FutureProvider.family<TrackDetail, String>((
  ref,
  trackId,
) {
  return ref.watch(coursesRepositoryProvider).getLearnTrackDetail(trackId);
});

final trackProgressProvider =
    FutureProvider.family<TrackProgressDashboard, String>((ref, trackId) {
      return ref
          .watch(coursesRepositoryProvider)
          .getLearnTrackProgress(trackId);
    });
