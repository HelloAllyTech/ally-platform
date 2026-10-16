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

  Future<List<ReviewItem>> getScribeReviews({String? readFilter}) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/scribe-session-reviews',
      queryParameters: {
        'sortBy': 'createdAt',
        'order': 'DESC',
        'limit': 25,
        'offset': 0,
        'readFilter': ?readFilter,
      },
    );
    final data = response.data?['data'] as List<dynamic>? ?? [];
    return data
        .map((e) => ReviewItem.fromJson(e as Map<String, dynamic>))
        .toList();
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
}

final scribeReviewsRepositoryProvider = Provider<ScribeReviewsRepository>((ref) {
  return ScribeReviewsRepository(ref.watch(apiClientProvider));
});

final scribeReviewsListProvider = FutureProvider<List<ReviewItem>>((ref) {
  return ref.watch(scribeReviewsRepositoryProvider).getScribeReviews();
});
