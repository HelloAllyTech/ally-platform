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

/// Mirrors ally-mobile (React Native)'s `src/constants/leaderboard.ts`
/// `LeaderboardPeriod`. Labels match the RN screen's own
/// `getPeriodLabel` (last-N-days framing, not literal "weekly/monthly").
enum LeaderboardWindow {
  lastWeek('LAST_WEEK', 'Last 7 days'),
  lastMonth('LAST_MONTH', 'Last 28 days'),
  lastYear('LAST_YEAR', 'Last 364 days'),
  allTime('ALL_TIME', 'All time');

  const LeaderboardWindow(this.apiValue, this.label);

  final String apiValue;
  final String label;
}

/// Ported from ally-mobile (React Native)'s `src/services/leaderboardApi.ts`.
class LeaderboardRepository {
  LeaderboardRepository(this._dio);

  final Dio _dio;

  Future<List<LeaderboardEntry>> getLeaderboard(LeaderboardWindow window) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/community/leaderboard',
      queryParameters: {'window': window.apiValue},
    );
    final data = response.data?['data'] as List<dynamic>? ?? [];
    return data
        .map((e) => LeaderboardEntry.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<LeaderboardEntry?> getMyRank(LeaderboardWindow window) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/community/leaderboard/my-rank',
      queryParameters: {'window': window.apiValue},
    );
    if (response.data == null) return null;
    return LeaderboardEntry.fromJson(response.data!);
  }
}

final leaderboardRepositoryProvider = Provider<LeaderboardRepository>((ref) {
  return LeaderboardRepository(ref.watch(apiClientProvider));
});

/// Riverpod 3.x has no `StateProvider` (removed along with
/// `StateNotifier`) — a one-field `Notifier` is the idiomatic replacement
/// for simple mutable UI state, same pattern as `AuthController`.
class LeaderboardWindowController extends Notifier<LeaderboardWindow> {
  @override
  LeaderboardWindow build() => LeaderboardWindow.lastWeek;

  void select(LeaderboardWindow window) => state = window;
}

final leaderboardWindowProvider =
    NotifierProvider<LeaderboardWindowController, LeaderboardWindow>(
  LeaderboardWindowController.new,
);

final leaderboardProvider = FutureProvider<List<LeaderboardEntry>>((ref) {
  final window = ref.watch(leaderboardWindowProvider);
  return ref.watch(leaderboardRepositoryProvider).getLeaderboard(window);
});

final myRankProvider = FutureProvider<LeaderboardEntry?>((ref) {
  final window = ref.watch(leaderboardWindowProvider);
  return ref.watch(leaderboardRepositoryProvider).getMyRank(window);
});
