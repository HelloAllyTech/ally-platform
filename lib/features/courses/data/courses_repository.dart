import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import 'course_models.dart';

/// Ported from ally-mobile (React Native)'s `src/services/coursesApi.ts` —
/// same routes (`src/constants/general.ts`'s `API_ROUTES.TRACKS`), same
/// backend contract. RTK Query's cache-tag invalidation isn't replicated
/// here; Riverpod screens re-fetch via `ref.invalidate` on the relevant
/// provider after a mutation instead, which is the Riverpod-idiomatic
/// equivalent for the mutations this phase actually needs.
///
/// Scope for this pass: the core read/progress endpoints and the mutations
/// needed for a working article/video flow. Quiz submission (multiple
/// question types: MCQ, Likert, matching, fill-blank), interjections, and
/// journal drafts are real further work — CourseItemPlayerScreen's ported
/// version here only handles ARTICLE and VIDEO items end-to-end.
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

  Future<void> startTrackItem(String itemId) async {
    await _dio.post<void>('/learn/tracks/items/$itemId/start');
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
