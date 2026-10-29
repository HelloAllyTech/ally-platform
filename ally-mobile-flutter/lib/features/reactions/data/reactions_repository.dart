import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';

/// Mirrors ally-mobile (React Native)'s `src/services/reactionsApi.ts`.
enum ReactionAction { add, remove, update }

String _actionToString(ReactionAction action) => switch (action) {
  ReactionAction.add => 'ADD',
  ReactionAction.remove => 'REMOVE',
  ReactionAction.update => 'UPDATE',
};

class ReactionUser {
  ReactionUser({
    required this.id,
    required this.name,
    required this.profileImage,
  });

  factory ReactionUser.fromJson(Map<String, dynamic> json) => ReactionUser(
    id: json['id'].toString(),
    name: json['name'] as String,
    profileImage: json['profileImage'] as String?,
  );

  final String id;
  final String name;
  final String? profileImage;
}

class Reaction {
  Reaction({required this.reaction, required this.createdBy});

  factory Reaction.fromJson(Map<String, dynamic> json) => Reaction(
    reaction: json['reaction'] as String,
    createdBy: ReactionUser.fromJson(json['createdBy'] as Map<String, dynamic>),
  );

  final String reaction;
  final ReactionUser createdBy;
}

/// RN's `useReactions` page size (`LIMIT = 20`).
const reactionsPageSize = 20;

/// One page of who-reacted rows plus the backend's total `count`, which RN
/// compares against the rows loaded so far to decide `hasMore`.
class ReactionsPage {
  const ReactionsPage({required this.items, required this.total});

  final List<Reaction> items;
  final int total;
}

/// Ported from ally-mobile (React Native)'s `ReactionsScreen` +
/// `reactionsApi.ts` — review-level reactions (`addReactionToReview`) and
/// comment-level reactions (`addReactionToComment`, used by thread
/// comments — see `reviews_repository.dart`'s `ReviewThread`).
class ReactionsRepository {
  ReactionsRepository(this._dio);

  final Dio _dio;

  Future<ReactionsPage> getReactions(
    String reviewId, {
    int offset = 0,
    int limit = reactionsPageSize,
    String? reaction,
  }) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/scenario-session-reviews/$reviewId/reactions',
      queryParameters: {'offset': offset, 'limit': limit, 'reaction': ?reaction},
    );
    final data = response.data?['data'] as List<dynamic>? ?? [];
    final items = data.map((e) => Reaction.fromJson(e as Map<String, dynamic>)).toList();
    return ReactionsPage(
      items: items,
      total: (response.data?['count'] as num?)?.toInt() ?? items.length,
    );
  }

  Future<Map<String, int>> getReactionsCount(String reviewId) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/scenario-session-reviews/$reviewId/reactions/count',
    );
    final reactions =
        response.data?['reactions'] as Map<String, dynamic>? ?? {};
    return reactions.map((key, value) => MapEntry(key, (value as num).toInt()));
  }

  Future<void> addReactionToReview({
    required String reviewId,
    required String reaction,
    required ReactionAction action,
  }) async {
    await _dio.post<void>(
      '/scenario-session-reviews/$reviewId/reactions',
      data: {'reaction': reaction, 'action': _actionToString(action)},
    );
  }

  Future<void> addReactionToComment({
    required String commentId,
    required String reaction,
    required ReactionAction action,
  }) async {
    await _dio.post<void>(
      '/scenario-session-reviews/comments/$commentId/reactions',
      data: {'reaction': reaction, 'action': _actionToString(action)},
    );
  }
}

final reactionsRepositoryProvider = Provider<ReactionsRepository>((ref) {
  return ReactionsRepository(ref.watch(apiClientProvider));
});


final reactionsCountProvider = FutureProvider.autoDispose.family<Map<String, int>, String>((
  ref,
  reviewId,
) {
  return ref.watch(reactionsRepositoryProvider).getReactionsCount(reviewId);
});

/// Mirrors ally-mobile (React Native)'s `src/services/scribeReactionsApi.ts`
/// — a separate service file with scribe-specific URLs
/// (`/scribe-session-reviews/...`) that reuses [Reaction]/[ReactionAction],
/// the same way `scribe_reviews_repository.dart` mirrors
/// `reviews_repository.dart`.
class ScribeReactionsRepository {
  ScribeReactionsRepository(this._dio);

  final Dio _dio;

  Future<ReactionsPage> getReactions(
    String reviewId, {
    int offset = 0,
    int limit = reactionsPageSize,
    String? reaction,
  }) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/scribe-session-reviews/$reviewId/reactions',
      queryParameters: {'offset': offset, 'limit': limit, 'reaction': ?reaction},
    );
    final data = response.data?['data'] as List<dynamic>? ?? [];
    final items = data.map((e) => Reaction.fromJson(e as Map<String, dynamic>)).toList();
    return ReactionsPage(
      items: items,
      total: (response.data?['count'] as num?)?.toInt() ?? items.length,
    );
  }

  Future<Map<String, int>> getReactionsCount(String reviewId) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/scribe-session-reviews/$reviewId/reactions/count',
    );
    final reactions =
        response.data?['reactions'] as Map<String, dynamic>? ?? {};
    return reactions.map((key, value) => MapEntry(key, (value as num).toInt()));
  }

  Future<void> addReactionToReview({
    required String reviewId,
    required String reaction,
    required ReactionAction action,
  }) async {
    await _dio.post<void>(
      '/scribe-session-reviews/$reviewId/reactions',
      data: {'reaction': reaction, 'action': _actionToString(action)},
    );
  }

  Future<void> addReactionToComment({
    required String commentId,
    required String reaction,
    required ReactionAction action,
  }) async {
    await _dio.post<void>(
      '/scribe-session-reviews/comments/$commentId/reactions',
      data: {'reaction': reaction, 'action': _actionToString(action)},
    );
  }
}

final scribeReactionsRepositoryProvider = Provider<ScribeReactionsRepository>((
  ref,
) {
  return ScribeReactionsRepository(ref.watch(apiClientProvider));
});

final scribeReactionsCountProvider =
    FutureProvider.autoDispose.family<Map<String, int>, String>((ref, reviewId) {
      return ref
          .watch(scribeReactionsRepositoryProvider)
          .getReactionsCount(reviewId);
    });
