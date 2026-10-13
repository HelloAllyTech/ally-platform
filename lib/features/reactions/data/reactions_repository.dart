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
  ReactionUser({required this.id, required this.name, required this.profileImage});

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

/// Ported from ally-mobile (React Native)'s `ReactionsScreen` +
/// `reactionsApi.ts` — review-level reactions only (`addReactionToReview`);
/// comment-level reactions (`addReactionToComment`) aren't wired, since
/// comment threads themselves aren't ported yet.
class ReactionsRepository {
  ReactionsRepository(this._dio);

  final Dio _dio;

  Future<List<Reaction>> getReactions(String reviewId, {int offset = 0, int limit = 50}) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/scenario-session-reviews/$reviewId/reactions',
      queryParameters: {'offset': offset, 'limit': limit},
    );
    final data = response.data?['data'] as List<dynamic>? ?? [];
    return data.map((e) => Reaction.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<Map<String, int>> getReactionsCount(String reviewId) async {
    final response = await _dio
        .get<Map<String, dynamic>>('/scenario-session-reviews/$reviewId/reactions/count');
    final reactions = response.data?['reactions'] as Map<String, dynamic>? ?? {};
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
}

final reactionsRepositoryProvider = Provider<ReactionsRepository>((ref) {
  return ReactionsRepository(ref.watch(apiClientProvider));
});

final reactionsListProvider =
    FutureProvider.family<List<Reaction>, String>((ref, reviewId) {
  return ref.watch(reactionsRepositoryProvider).getReactions(reviewId);
});

final reactionsCountProvider =
    FutureProvider.family<Map<String, int>, String>((ref, reviewId) {
  return ref.watch(reactionsRepositoryProvider).getReactionsCount(reviewId);
});
