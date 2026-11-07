import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../core/widgets/review_type_chip.dart';
import '../../achievements/data/achievements_repository.dart';
import '../../reactions/data/reactions_repository.dart';
import 'review_models.dart';

/// RN's `AddReviewCommentResponse` — which ids the backend created.
typedef AddCommentResult = ({
  ({String id, String? createdAt})? comment,
  ({String id, String? createdAt})? thread,
  ({String id, String? createdAt})? reply,
});

/// The comment/transcript half of a review's API — RN's `ReviewApiContext`,
/// which swaps one set of RTK hooks for the other by review type. Simulation
/// reviews live under `/scenario-session-reviews`, scribe reviews under
/// `/scribe-session-reviews`, with identical paths and bodies below that, so
/// one class keyed by [reviewType] covers both (ally-be's two
/// `comment.controller.ts` files are the same shape).
class ReviewApi {
  ReviewApi(this._dio, this.reviewType, {void Function()? onBadgesChanged}) : _onBadgesChanged = onBadgesChanged;

  final Dio _dio;
  final ReviewType reviewType;

  /// RN `invalidatesTags: ['Badges']` (reviewer badges can unlock): on
  /// `addReviewComment`/`deleteComment` for simulation reviews, and on
  /// `addReactionToReview` for both kinds. Wired to `badgesProvider`.
  final void Function()? _onBadgesChanged;

  void _badgesChangedIf(bool condition) {
    if (condition) _onBadgesChanged?.call();
  }

  String get _base =>
      reviewType == ReviewType.scribe ? '/scribe-session-reviews' : '/scenario-session-reviews';

  static CommentPage _page(Map<String, dynamic>? body) => (
    comments: (body?['data'] as List<dynamic>? ?? [])
        .map((e) => ThreadComment.fromJson(e as Map<String, dynamic>))
        .toList(),
    count: (body?['count'] as num?)?.toInt() ?? 0,
  );

  /// `getMessages` — the review's transcript, paged (RN: 10 per page).
  Future<List<TranscriptMessage>> getMessages(String reviewId, {required int offset, required int limit}) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '$_base/$reviewId/messages',
      queryParameters: {'offset': offset, 'limit': limit},
    );
    return (response.data?['data'] as List<dynamic>? ?? [])
        .map((e) => TranscriptMessage.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// `getGeneralCommentsOverview` — the latest couple of comments across the
  /// review, shown inline on a `ReviewCard` (`ExpandedComments`).
  Future<CommentPage> getCommentsOverview(String reviewId, {int offset = 0, int limit = 2}) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '$_base/$reviewId/comments-overview',
      queryParameters: {'offset': offset, 'limit': limit, 'sortOrder': 'DESC', 'sortBy': 'createdAt'},
    );
    return _page(response.data);
  }

  /// `getGeneralReviewComments` — the review's general (not transcript-
  /// anchored) comments.
  Future<CommentPage> getGeneralComments(String reviewId, {required int offset, required int limit}) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '$_base/$reviewId/comments',
      queryParameters: {'offset': offset, 'limit': limit},
    );
    return _page(response.data);
  }

  /// `getThreads` — every transcript-anchored thread, each with its anchor
  /// message (`includeMessage`).
  Future<({List<ReviewThread> threads, int count})> getThreads(
    String reviewId, {
    required int offset,
    required int limit,
  }) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '$_base/$reviewId/threads',
      queryParameters: {'offset': offset, 'limit': limit, 'includeMessage': true},
    );
    return (
      threads: (response.data?['data'] as List<dynamic>? ?? [])
          .map((e) => ReviewThread.fromJson(e as Map<String, dynamic>))
          .toList(),
      count: (response.data?['count'] as num?)?.toInt() ?? 0,
    );
  }

  /// `getThreadComments` — the root comments of one thread.
  Future<CommentPage> getThreadComments(String threadId, {required int offset, required int limit}) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '$_base/threads/$threadId/comments',
      queryParameters: {'offset': offset, 'limit': limit},
    );
    return _page(response.data);
  }

  /// `getCommentReplies` — replies to one comment.
  Future<CommentPage> getCommentReplies(String commentId, {required int offset, required int limit}) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '$_base/comments/$commentId/replies',
      queryParameters: {'offset': offset, 'limit': limit},
    );
    return _page(response.data);
  }

  /// `addReviewComment` — one endpoint for every kind of comment, told apart
  /// by which ids are sent: [threadId] adds to an existing thread (general
  /// or anchored), [parentCommentId] replies to a comment, and
  /// [messageId] + [selection] start a new transcript-anchored thread.
  Future<AddCommentResult> addComment({
    required String reviewId,
    required String content,
    String? threadId,
    String? parentCommentId,
    String? messageId,
    ReviewTextSelection? selection,
  }) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '$_base/$reviewId/comments',
      data: {
        'threadId': ?threadId,
        'parentCommentId': ?parentCommentId,
        'messageId': ?(messageId == null ? null : int.tryParse(messageId) ?? messageId),
        'selection': ?selection?.toJson(),
        'content': content,
      },
    );
    _badgesChangedIf(reviewType == ReviewType.simulation);
    ({String id, String? createdAt})? entity(String key) {
      final value = response.data?[key];
      if (value is! Map<String, dynamic> || value['id'] == null) return null;
      return (id: value['id'].toString(), createdAt: value['createdAt'] as String?);
    }

    return (comment: entity('comment'), thread: entity('thread'), reply: entity('reply'));
  }

  Future<void> updateComment({required String commentId, required String content}) async {
    await _dio.patch<void>('$_base/comments/$commentId', data: {'content': content});
  }

  Future<void> deleteComment(String commentId) async {
    await _dio.delete<void>('$_base/comments/$commentId');
    _badgesChangedIf(reviewType == ReviewType.simulation);
  }

  Future<void> updateCommentVisibility({required String commentId, required bool hidden}) async {
    await _dio.patch<void>('$_base/comments/$commentId/visibility', data: {'hidden': hidden});
  }

  Future<void> addReactionToComment({
    required String commentId,
    required String reaction,
    required ReactionAction action,
  }) async {
    await _dio.post<void>(
      '$_base/comments/$commentId/reactions',
      data: {'reaction': reaction, 'action': _actionValue(action)},
    );
  }

  Future<void> addReactionToReview({
    required String reviewId,
    required String reaction,
    required ReactionAction action,
  }) async {
    await _dio.post<void>(
      '$_base/$reviewId/reactions',
      data: {'reaction': reaction, 'action': _actionValue(action)},
    );
    _badgesChangedIf(true);
  }
}

String _actionValue(ReactionAction action) => switch (action) {
  ReactionAction.add => 'ADD',
  ReactionAction.remove => 'REMOVE',
  ReactionAction.update => 'UPDATE',
};

/// RN's `getReactionAction(currentEmoji, unicode)`.
ReactionAction reactionActionFor(String? currentEmoji, String unicode) {
  if (currentEmoji == null) return ReactionAction.add;
  if (currentEmoji != unicode) return ReactionAction.update;
  return ReactionAction.remove;
}

final reviewApiProvider = Provider.family<ReviewApi, ReviewType>(
  (ref, reviewType) => ReviewApi(
    ref.watch(apiClientProvider),
    reviewType,
    onBadgesChanged: () => ref.invalidate(badgesProvider),
  ),
);
