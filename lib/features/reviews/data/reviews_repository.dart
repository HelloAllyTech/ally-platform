import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import 'review_models.dart';

/// Ported from ally-mobile (React Native)'s `src/services/reviewsApi.ts`.
/// Scoped to the list + mark-read + detail fetch; comment threads,
/// reactions, and review-status updates (the full `ReviewDetailsScreen`/
/// `ShareForReviewScreen` flows) are real further work.
class ReviewsRepository {
  ReviewsRepository(this._dio);

  final Dio _dio;

  Future<List<ReviewItem>> getReviews({String? readFilter}) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/scenario-session-reviews',
      queryParameters: {
        'sortBy': 'createdAt',
        'order': 'DESC',
        'limit': 25,
        'offset': 0,
        if (readFilter != null) 'readFilter': readFilter,
      },
    );
    final data = response.data?['data'] as List<dynamic>? ?? [];
    return data.map((e) => ReviewItem.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<ReviewItem> getReview(String reviewId) async {
    final response =
        await _dio.get<Map<String, dynamic>>('/scenario-session-reviews/$reviewId');
    return ReviewItem.fromJson(response.data!);
  }

  Future<void> markAsRead(String reviewId) async {
    await _dio.patch<void>('/scenario-session-reviews/$reviewId/mark-read');
  }

  /// Matches ally-mobile (React Native)'s `CreateReviewRequest` exactly:
  /// just the session being shared plus a note.
  Future<void> createReview({
    required String scenarioSessionId,
    required String note,
  }) async {
    await _dio.post<void>(
      '/scenario-session-reviews',
      data: {'scenarioSessionId': scenarioSessionId, 'note': note},
    );
  }
}

final reviewsRepositoryProvider = Provider<ReviewsRepository>((ref) {
  return ReviewsRepository(ref.watch(apiClientProvider));
});

final reviewsListProvider = FutureProvider<List<ReviewItem>>((ref) {
  return ref.watch(reviewsRepositoryProvider).getReviews();
});

final reviewDetailProvider =
    FutureProvider.family<ReviewItem, String>((ref, reviewId) {
  return ref.watch(reviewsRepositoryProvider).getReview(reviewId);
});
