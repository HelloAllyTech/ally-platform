import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';

/// Mirrors ally-mobile (React Native)'s `src/types/leaderboard.ts`.
class LeaderboardEntry {
  LeaderboardEntry({
    required this.userId,
    required this.name,
    required this.profileImageUrl,
    required this.rank,
    required this.minutesPlayed,
    required this.badgeCount,
  });

  factory LeaderboardEntry.fromJson(Map<String, dynamic> json) => LeaderboardEntry(
        userId: (json['userId'] as num).toInt(),
        name: json['name'] as String,
        profileImageUrl: json['profileImageUrl'] as String? ?? '',
        rank: (json['rank'] as num).toInt(),
        minutesPlayed: (json['minutesPlayed'] as num?)?.toInt() ?? 0,
        badgeCount: (json['badgeCount'] as num?)?.toInt() ?? 0,
      );

  final int userId;
  final String name;
  final String profileImageUrl;
  final int rank;
  final int minutesPlayed;
  final int badgeCount;
}

/// Ported from ally-mobile (React Native)'s `src/services/leaderboardApi.ts`.
/// `window` defaults to the backend's own default period (weekly, per the
/// RN screen) rather than being made a user-facing filter in this pass.
class LeaderboardRepository {
  LeaderboardRepository(this._dio);

  final Dio _dio;

  Future<List<LeaderboardEntry>> getLeaderboard() async {
    final response =
        await _dio.get<Map<String, dynamic>>('/community/leaderboard');
    final data = response.data?['data'] as List<dynamic>? ?? [];
    return data
        .map((e) => LeaderboardEntry.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<LeaderboardEntry?> getMyRank() async {
    final response = await _dio
        .get<Map<String, dynamic>>('/community/leaderboard/my-rank');
    if (response.data == null) return null;
    return LeaderboardEntry.fromJson(response.data!);
  }
}

final leaderboardRepositoryProvider = Provider<LeaderboardRepository>((ref) {
  return LeaderboardRepository(ref.watch(apiClientProvider));
});

final leaderboardProvider = FutureProvider<List<LeaderboardEntry>>((ref) {
  return ref.watch(leaderboardRepositoryProvider).getLeaderboard();
});

final myRankProvider = FutureProvider<LeaderboardEntry?>((ref) {
  return ref.watch(leaderboardRepositoryProvider).getMyRank();
});
