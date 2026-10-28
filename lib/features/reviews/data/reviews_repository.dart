import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../core/permissions/permissions_repository.dart';
import '../../../core/permissions/user_permissions.dart';
import 'review_models.dart';

/// Ported from ally-mobile (React Native)'s `src/services/reviewsApi.ts`.
/// Scoped to the list + mark-read + detail fetch; comment threads,
/// reactions, and review-status updates (the full `ReviewDetailsScreen`/
/// `ShareForReviewScreen` flows) are real further work.
class ReviewsRepository {
  ReviewsRepository(this._dio);

  final Dio _dio;

  /// `sortBy` mirrors RN's `SortBy` enum values exactly ('LATEST' /
  /// 'MOST_VIEWED' / 'MOST_COMMENTED') — confirmed from `useReviews.ts`'s
  /// real query, which sends `sortBy`/`readFilter`/`limit`/`offset` only
  /// (no `order` param; this previously sent `sortBy: 'createdAt', order:
  /// 'DESC'`, a shape the real backend doesn't use at all).
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

  /// Flat, non-transcript-anchored discussion on a review. The real RN app
  /// (`reviewsApi.ts`'s `getGeneralReviewComments`/`addReviewComment`) hits
  /// GET/POST `/scenario-session-reviews/:reviewId/comments` — the same
  /// path `addThreadReply` posts to, just without a `threadId`. The
  /// `/general-comments` suffix is a route constant RN defines but never
  /// actually wires to a request.
  Future<List<ReviewComment>> getGeneralComments(String reviewId) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/scenario-session-reviews/$reviewId/comments',
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
      '/scenario-session-reviews/$reviewId/comments',
      data: {'content': content},
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

  /// Replies beyond whatever page `getThreads` included inline — matches
  /// `getCommentReplies`.
  Future<({List<ThreadComment> replies, int count})> getCommentReplies(
    String commentId, {
    int offset = 0,
    int limit = 20,
  }) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/scenario-session-reviews/comments/$commentId/replies',
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

  /// Matches `addReviewComment` — a reply within an existing thread
  /// (`threadId` set). Starting a *new* thread anchored to a fresh
  /// transcript selection (`messageId`/`selection`, no `threadId`) isn't
  /// wired here: that needs a transcript view with tappable message
  /// selection inside the review context, which doesn't exist yet (the
  /// Transcript tab ported for `SimulationFeedbackScreen` is a different
  /// screen, for the learner's own post-session view, not the reviewer's).
  Future<void> addThreadReply({
    required String reviewId,
    required String threadId,
    required String content,
  }) async {
    await _dio.post<void>(
      '/scenario-session-reviews/$reviewId/comments',
      data: {'threadId': threadId, 'content': content},
    );
  }

  /// Matches `useUpdateCommentMutation` — editing is only offered within
  /// `EDIT_COMMENT_TIME_LIMIT_MINUTES` of posting, and only to the
  /// comment's own author (see `ReviewComment.tsx`'s `getMenuOptions`).
  Future<void> updateComment({
    required String commentId,
    required String content,
  }) async {
    await _dio.patch<void>(
      '/scenario-session-reviews/comments/$commentId',
      data: {'content': content},
    );
  }

  /// Matches `useDeleteCommentMutation` — only offered to the comment's own
  /// author, same ownership check as [updateComment].
  Future<void> deleteComment(String commentId) async {
    await _dio.delete<void>('/scenario-session-reviews/comments/$commentId');
  }

  /// Matches `useUpdateCommentVisibilityMutation` — Hide/Unhide, offered
  /// only to the *review's* owner (a different identity from the
  /// comment's own author — see `ReviewComment.tsx`'s `getMenuOptions`).
  Future<void> updateCommentVisibility({
    required String commentId,
    required bool hidden,
  }) async {
    await _dio.patch<void>(
      '/scenario-session-reviews/comments/$commentId/visibility',
      data: {'hidden': hidden},
    );
  }
}

final reviewsRepositoryProvider = Provider<ReviewsRepository>((ref) {
  return ReviewsRepository(ref.watch(apiClientProvider));
});


/// Simulation-review half of RN's `hasUnreadReviews` (`simUnread.count +
/// scribeUnread.count > 0`) — the scribe-review half isn't modeled yet
/// since scribe review browsing itself isn't ported, only Scribe
/// recording. Revisit once that lands.
///
/// Only reviewers can have unread reviews: ally-be answers anyone else with
/// a 403, which Riverpod then retried — 6 failed calls per launch for every
/// learner. RN fires it unconditionally too, but RTK Query doesn't retry.
final unreadReviewCountProvider = FutureProvider<int>((ref) async {
  final repository = ref.watch(reviewsRepositoryProvider);
  final permissions = await ref.watch(userPermissionsProvider.future);
  if (!permissions.contains(UserPermissions.simulationReviewerAccess)) return 0;
  return repository.getUnreadCount();
});

final reviewDetailProvider = FutureProvider.family<ReviewItem, String>((
  ref,
  reviewId,
) {
  return ref.watch(reviewsRepositoryProvider).getReview(reviewId);
});

final generalCommentsProvider =
    FutureProvider.family<List<ReviewComment>, String>((ref, reviewId) {
      return ref.watch(reviewsRepositoryProvider).getGeneralComments(reviewId);
    });

final reviewThreadsProvider = FutureProvider.family<List<ReviewThread>, String>(
  (ref, reviewId) async {
    final result = await ref
        .watch(reviewsRepositoryProvider)
        .getThreads(reviewId);
    return result.threads;
  },
);
