import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import 'course_models.dart';
import 'quiz_models.dart';
import 'start_item_payload.dart';

/// Ported from ally-mobile (React Native)'s `src/services/coursesApi.ts` —
/// same routes (`src/constants/general.ts`'s `API_ROUTES.TRACKS`), same
/// backend contract. RTK Query's cache-tag invalidation isn't replicated
/// here; Riverpod screens re-fetch via `ref.invalidate` on the relevant
/// provider after a mutation instead, which is the Riverpod-idiomatic
/// equivalent for the mutations this phase actually needs.
///
/// Scope: ARTICLE, VIDEO, QUIZ (all 8 question types), JOURNAL, and GAME
/// items end-to-end.
class CoursesRepository {
  CoursesRepository(this._dio);

  final Dio _dio;

  Future<List<TrackListItem>> getLearnTracks() async {
    final response = await _dio.get<Map<String, dynamic>>('/learn/tracks');
    final data = response.data?['data'] as List<dynamic>? ?? [];
    return data
        .map((e) => TrackListItem.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<TrackDetail> getLearnTrackDetail(String trackId) async {
    final response =
        await _dio.get<Map<String, dynamic>>('/learn/tracks/$trackId');
    return TrackDetail.fromJson(response.data!);
  }

  Future<TrackProgressDashboard> getLearnTrackProgress(String trackId) async {
    final response = await _dio
        .get<Map<String, dynamic>>('/learn/tracks/$trackId/progress');
    return TrackProgressDashboard.fromJson(response.data!);
  }

  Future<void> enrollTrack(String trackId) async {
    await _dio.post<void>('/learn/tracks/$trackId/enroll');
  }

  /// Returns the real per-type content payload (quiz questions, article
  /// HTML + inline questions, video URL + interjections) — same
  /// discriminated-union contract as RN's `StartTrackItemResponse`.
  Future<StartItemPayload> startTrackItem(String itemId) async {
    final response = await _dio.post<Map<String, dynamic>>('/learn/tracks/items/$itemId/start');
    return StartItemPayload.fromJson(response.data!);
  }

  Future<void> markArticleRead(String itemId) async {
    await _dio.post<void>('/learn/tracks/items/$itemId/article-read');
  }

  /// Fires roughly every 10s during video playback, matching the RN
  /// screen's own cadence comment in `coursesApi.ts`.
  Future<void> reportVideoProgress({
    required String itemId,
    required double watchedPct,
  }) async {
    await _dio.post<void>(
      '/learn/tracks/items/$itemId/video-progress',
      data: {'watchedPct': watchedPct},
    );
  }

  Future<({bool correct, String correctOptionId, String? explanation})> submitArticleQuestionAnswer({
    required String itemId,
    required String questionId,
    required String selectedOptionId,
  }) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/learn/tracks/items/$itemId/article-questions/$questionId/answer',
      data: {'selectedOptionId': selectedOptionId},
    );
    return (
      correct: response.data!['correct'] as bool,
      correctOptionId: response.data!['correctOptionId'] as String,
      explanation: response.data!['explanation'] as String?,
    );
  }

  Future<({bool? correct, int pointsAwarded})> submitInterjectionAnswer({
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
          for (final r in responses) {'promptId': r.promptId, 'response': r.response},
        ],
      },
    );
  }

  Future<void> submitJournal(String itemId) async {
    await _dio.post<void>('/learn/tracks/items/$itemId/journal/submit');
  }

  /// A game item is already complete server-side by the time this fires
  /// (the server marks it done the moment it's opened) — this just records
  /// a personal-best run, same as the RN screen's own doc comment.
  Future<int> recordGameResult({required String itemId, required int score}) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/learn/tracks/items/$itemId/game-result',
      data: {'score': score},
    );
    return (response.data?['bestScore'] as num?)?.toInt() ?? score;
  }
}

final coursesRepositoryProvider = Provider<CoursesRepository>((ref) {
  return CoursesRepository(ref.watch(apiClientProvider));
});

final learnTracksProvider = FutureProvider<List<TrackListItem>>((ref) {
  return ref.watch(coursesRepositoryProvider).getLearnTracks();
});

final trackDetailProvider =
    FutureProvider.family<TrackDetail, String>((ref, trackId) {
  return ref.watch(coursesRepositoryProvider).getLearnTrackDetail(trackId);
});

final trackProgressProvider =
    FutureProvider.family<TrackProgressDashboard, String>((ref, trackId) {
  return ref.watch(coursesRepositoryProvider).getLearnTrackProgress(trackId);
});
