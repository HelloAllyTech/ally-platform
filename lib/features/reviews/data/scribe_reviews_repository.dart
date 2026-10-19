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

  /// Flat, non-transcript-anchored discussion — byte-for-byte path mirror
  /// of `ReviewsRepository.getGeneralComments`/`addGeneralComment` with
  /// `scenario-session-reviews` swapped for `scribe-session-reviews` (same
  /// `scribeReviewsApi.ts` `getScribeGeneralReviewComments`/
  /// `addScribeReviewComment` pair, GET/POST `/comments` with no
  /// `threadId`).
  Future<List<ReviewComment>> getGeneralComments(String reviewId) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/scribe-session-reviews/$reviewId/comments',
    );
    final data = response.data?['data'] as List<dynamic>? ?? [];
    return data
        .map((e) => ReviewComment.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> addGeneralComment({
    required String reviewId,
    required String content,
  }) async {
    await _dio.post<void>(
      '/scribe-session-reviews/$reviewId/comments',
      data: {'content': content},
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

  /// Mirrors `ReviewsRepository.getCommentReplies`
  /// (`scribeReviewThreadsApi.ts`'s `getScribeCommentReplies`).
  Future<({List<ThreadComment> replies, int count})> getCommentReplies(
    String commentId, {
    int offset = 0,
    int limit = 20,
  }) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/scribe-session-reviews/comments/$commentId/replies',
      queryParameters: {'offset': offset, 'limit': limit},
    );
    final data = response.data?['data'] as List<dynamic>? ?? [];
    return (
      replies: data
          .map((e) => ThreadComment.fromJson(e as Map<String, dynamic>))
          .toList(),
      count: (response.data?['count'] as num?)?.toInt() ?? 0,
    );
  }

  /// Mirrors `ReviewsRepository.addThreadReply`
  /// (`scribeReviewsApi.ts`'s `addScribeReviewComment` with `threadId` set).
  Future<void> addThreadReply({
    required String reviewId,
    required String threadId,
    required String content,
  }) async {
    await _dio.post<void>(
      '/scribe-session-reviews/$reviewId/comments',
      data: {'threadId': threadId, 'content': content},
    );
  }
}

final scribeReviewsRepositoryProvider = Provider<ScribeReviewsRepository>((ref) {
  return ScribeReviewsRepository(ref.watch(apiClientProvider));
});

final scribeReviewsListProvider = FutureProvider<List<ReviewItem>>((ref) {
  return ref.watch(scribeReviewsRepositoryProvider).getScribeReviews();
});

final scribeReviewDetailProvider = FutureProvider.family<ReviewItem, String>((
  ref,
  reviewId,
) {
  return ref.watch(scribeReviewsRepositoryProvider).getScribeReview(reviewId);
});

final scribeGeneralCommentsProvider =
    FutureProvider.family<List<ReviewComment>, String>((ref, reviewId) {
      return ref
          .watch(scribeReviewsRepositoryProvider)
          .getGeneralComments(reviewId);
    });

final scribeReviewThreadsProvider =
    FutureProvider.family<List<ReviewThread>, String>((ref, reviewId) async {
      final result = await ref
          .watch(scribeReviewsRepositoryProvider)
          .getThreads(reviewId);
      return result.threads;
    });
