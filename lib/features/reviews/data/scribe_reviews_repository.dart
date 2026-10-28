import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import 'review_models.dart';

/// Ported from ally-mobile (React Native)'s `src/services/
/// scribeReviewsApi.ts` — the "Scribe" sub-tab's data source on
/// ReviewScreen, a distinct endpoint/list from the simulation reviews in
/// `reviews_repository.dart`. Same `ReviewItem` shape (the RN types carry
/// the same scenario-vs-scribe-session union, not two separate interfaces
/// for the fields this scoped port surfaces), just a different route.
class ScribeReviewsRepository {
  ScribeReviewsRepository(this._dio);

  final Dio _dio;

  /// One page of RN's `useReviews` infinite list (`LIMIT = 10`).
  Future<ReviewsPage> getScribeReviews({
    String? readFilter,
    String sortBy = 'LATEST',
    int limit = 10,
    int offset = 0,
  }) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/scribe-session-reviews',
      queryParameters: {
        'sortBy': sortBy,
        'limit': limit,
        'offset': offset,
        'readFilter': ?readFilter,
      },
    );
    final data = response.data?['data'] as List<dynamic>? ?? [];
    return (
      items: data.map((e) => ReviewItem.fromJson(e as Map<String, dynamic>)).toList(),
      count: (response.data?['count'] as num?)?.toInt() ?? data.length,
    );
  }

  Future<ReviewItem> getScribeReview(String reviewId) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/scribe-session-reviews/$reviewId',
    );
    return ReviewItem.fromJson(response.data!);
  }

  Future<void> markAsRead(String reviewId) async {
    await _dio.patch<void>('/scribe-session-reviews/$reviewId/mark-read');
  }

  /// Mirrors ally-mobile (React Native)'s `createScribeReview`
  /// (`scribeReviewsApi.ts`) — POST `/scribe-session-reviews`, a genuinely
  /// separate backend resource from `ReviewsRepository.createReview`'s
  /// `/scenario-session-reviews` (confirmed from `src/constants/
  /// general.ts`'s `API_ROUTES.SCRIBE_REVIEWS`/`API_ROUTES.TRACKS`
  /// distinction — the two review systems are never the same endpoint
  /// despite both being "a review of a session"). Returns the new review's
  /// id, matching RN's `CreateScribeReviewResponse`.
  Future<String> createReview({
    required int scribeSessionId,
    required String note,
  }) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/scribe-session-reviews',
      data: {'scribeSessionId': scribeSessionId, 'note': note},
    );
    return response.data!['id'] as String;
  }

  /// Mirrors ally-mobile (React Native)'s `updateScribeReviewStatus` — same
  /// request shape as `ReviewsRepository.updateReviewStatus`, just the
  /// scribe-review resource path.
  Future<void> updateReviewStatus({
    required String reviewId,
    required String status,
    String? note,
  }) async {
    await _dio.patch<void>(
      '/scribe-session-reviews/$reviewId',
      data: {'status': status, 'note': ?note},
    );
  }

  /// Transcript-anchored discussion threads — mirrors
  /// `ReviewsRepository.getThreads` (`scribeReviewThreadsApi.ts`'s
  /// `getScribeThreads`, which also always forces `includeMessage: true`).
  Future<({List<ReviewThread> threads, int count})> getThreads(
    String reviewId, {
    int offset = 0,
    int limit = 20,
  }) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/scribe-session-reviews/$reviewId/threads',
      queryParameters: {
        'offset': offset,
        'limit': limit,
        'includeMessage': true,
      },
    );
    final data = response.data?['data'] as List<dynamic>? ?? [];
    return (
      threads: data
          .map((e) => ReviewThread.fromJson(e as Map<String, dynamic>))
          .toList(),
      count: (response.data?['count'] as num?)?.toInt() ?? 0,
    );
  }

}

final scribeReviewsRepositoryProvider = Provider<ScribeReviewsRepository>((ref) {
  return ScribeReviewsRepository(ref.watch(apiClientProvider));
});

final scribeReviewDetailProvider = FutureProvider.family<ReviewItem, String>((
  ref,
  reviewId,
) {
  return ref.watch(scribeReviewsRepositoryProvider).getScribeReview(reviewId);
});

