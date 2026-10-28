import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../core/permissions/permissions_repository.dart';
import '../../../core/permissions/user_permissions.dart';
import 'review_models.dart';
import 'scribe_reviews_repository.dart';

/// Ported from ally-mobile (React Native)'s `src/services/reviewsApi.ts`.
/// Scoped to the list + mark-read + detail fetch; comment threads,
/// reactions, and review-status updates (the full `ReviewDetailsScreen`/
/// `ShareForReviewScreen` flows) are real further work.
class ReviewsRepository {
  ReviewsRepository(this._dio);

  final Dio _dio;

  /// `sortBy` mirrors RN's `SortBy` enum values exactly ('LATEST' /
  /// 'MOST_VIEWED' / 'MOST_COMMENTED'), sent with `readFilter`/`limit`/
  /// `offset` and `order: 'DESC'` exactly as RN `reviewsApi.getReviews`.
  /// One page of RN's `useReviews` infinite list (`LIMIT = 10`).
  Future<ReviewsPage> getReviews({
    String? readFilter,
    String sortBy = 'LATEST',
    int limit = 10,
    int offset = 0,
  }) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/scenario-session-reviews',
      queryParameters: {
        'sortBy': sortBy,
        'limit': limit,
        'offset': offset,
        'readFilter': ?readFilter,
        // RN `getReviews`/`getScribeReviews` always send `order: DESC`.
        'order': 'DESC',
      },
    );
    final data = response.data?['data'] as List<dynamic>? ?? [];
    return (
      items: data.map((e) => ReviewItem.fromJson(e as Map<String, dynamic>)).toList(),
      count: (response.data?['count'] as num?)?.toInt() ?? data.length,
    );
  }

  Future<ReviewItem> getReview(String reviewId) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/scenario-session-reviews/$reviewId',
    );
    return ReviewItem.fromJson(response.data!);
  }

  /// Drives the unread-review dot on the Review tab's bottom-bar icon.
  Future<int> getUnreadCount() async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/scenario-session-reviews/unread-count',
    );
    return (response.data?['count'] as num?)?.toInt() ?? 0;
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

  /// Matches ally-mobile (React Native)'s `useUpdateReviewStatusMutation` —
  /// same route/method, used both for the real status transitions (e.g.
  /// hiding a review) and, with `status: 'IN_REVIEW'`, as the actual
  /// edit-note save/re-share call `ShareForReviewScreen` makes once a
  /// review already exists.
  Future<void> updateReviewStatus({
    required String reviewId,
    required String status,
    String? note,
  }) async {
    await _dio.patch<void>(
      '/scenario-session-reviews/$reviewId',
      data: {'status': status, 'note': ?note},
    );
  }

  /// Transcript-anchored discussion threads — matches `reviewThreadsApi.ts`'s
  /// `getThreads` (`includeMessage: true`, same as the RN screen always
  /// passes, so each thread carries its anchor message).
  Future<({List<ReviewThread> threads, int count})> getThreads(
    String reviewId, {
    int offset = 0,
    int limit = 20,
  }) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/scenario-session-reviews/$reviewId/threads',
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

final reviewsRepositoryProvider = Provider<ReviewsRepository>((ref) {
  return ReviewsRepository(ref.watch(apiClientProvider));
});

/// RN TabNavigator's `hasUnreadReviews` total: `simUnread.count +
/// scribeUnread.count` (each `?? 0`, so one failing doesn't hide the other).
///
/// Each half is only asked of users ally-be will answer: anyone else gets a
/// 403, which Riverpod then retried — 6 failed calls per launch for every
/// learner. RN fires both unconditionally, but RTK Query doesn't retry.
final unreadReviewCountProvider = FutureProvider<int>((ref) async {
  final repository = ref.watch(reviewsRepositoryProvider);
  final permissions = await ref.watch(userPermissionsProvider.future);
  Future<int> countOrZero(Future<int> Function() fetch) async {
    try {
      return await fetch();
    } catch (_) {
      return 0;
    }
  }

  final counts = await Future.wait([
    if (permissions.contains(UserPermissions.simulationReviewerAccess)) countOrZero(repository.getUnreadCount),
    if (permissions.contains(UserPermissions.viewScribeReviews))
      countOrZero(ref.watch(scribeReviewsRepositoryProvider).getUnreadCount),
  ]);
  return counts.fold<int>(0, (sum, count) => sum + count);
});

/// RN `keepUnusedDataFor: 0` + `refetchOnMountOrArgChange`: dropped as
/// soon as nothing shows it, so every open of the review fetches it fresh.
final reviewDetailProvider = FutureProvider.autoDispose.family<ReviewItem, String>((
  ref,
  reviewId,
) {
  return ref.watch(reviewsRepositoryProvider).getReview(reviewId);
});

