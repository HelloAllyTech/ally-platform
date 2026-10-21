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

/// Mirrors RN's `MyRankResponse` — a superset of `LeaderboardEntry` with the
/// `hideRankInCommunity` flag that gates the rank column for the whole table,
/// not just the current user's own row.
class LeaderboardMyRank {
  LeaderboardMyRank({
    required this.userId,
    required this.name,
    required this.profileImageUrl,
    required this.rank,
    required this.minutesPlayed,
    required this.badgeCount,
    required this.hideRankInCommunity,
  });

  factory LeaderboardMyRank.fromJson(Map<String, dynamic> json) => LeaderboardMyRank(
        userId: (json['userId'] as num).toInt(),
        name: json['name'] as String,
        profileImageUrl: json['profileImageUrl'] as String? ?? '',
        rank: (json['rank'] as num).toInt(),
        minutesPlayed: (json['minutesPlayed'] as num?)?.toInt() ?? 0,
        badgeCount: (json['badgeCount'] as num?)?.toInt() ?? 0,
        hideRankInCommunity: json['hideRankInCommunity'] as bool? ?? false,
      );

  final int userId;
  final String name;
  final String profileImageUrl;
  final int rank;
  final int minutesPlayed;
  final int badgeCount;
  final bool hideRankInCommunity;
}

/// Matches RN's own `LEADERBOARD_FETCH_LIMIT` (the page size the real screen
/// passes to `useLeaderboard`, not the hook's own unused `limit=50` default).
const kLeaderboardPageSize = 30;

/// Ported from ally-mobile (React Native)'s `src/services/leaderboardApi.ts`.
class LeaderboardRepository {
  LeaderboardRepository(this._dio);

  final Dio _dio;

  /// Mirrors RN's `LeaderboardResponse` — a page of entries plus the real
  /// `totalCount`, which is what makes "is there another page?" decidable.
  Future<({List<LeaderboardEntry> items, int totalCount})> getLeaderboard(
    LeaderboardWindow window, {
    int limit = kLeaderboardPageSize,
    int offset = 0,
  }) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/community/leaderboard',
      queryParameters: {'window': window.apiValue, 'limit': limit, 'offset': offset},
    );
    final data = response.data?['data'] as List<dynamic>? ?? [];
    return (
      items: data.map((e) => LeaderboardEntry.fromJson(e as Map<String, dynamic>)).toList(),
      totalCount: (response.data?['totalCount'] as num?)?.toInt() ?? data.length,
    );
  }

  Future<LeaderboardMyRank?> getMyRank(LeaderboardWindow window) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/community/leaderboard/my-rank',
      queryParameters: {'window': window.apiValue},
    );
    if (response.data == null) return null;
    return LeaderboardMyRank.fromJson(response.data!);
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

final myRankProvider = FutureProvider<LeaderboardMyRank?>((ref) {
  final window = ref.watch(leaderboardWindowProvider);
  return ref.watch(leaderboardRepositoryProvider).getMyRank(window);
});

class LeaderboardPage {
  LeaderboardPage({required this.items, required this.totalCount, required this.hasMore, this.isLoadingMore = false});

  final List<LeaderboardEntry> items;
  final int totalCount;
  final bool hasMore;
  final bool isLoadingMore;

  LeaderboardPage copyWith({bool? isLoadingMore}) => LeaderboardPage(
        items: items,
        totalCount: totalCount,
        hasMore: hasMore,
        isLoadingMore: isLoadingMore ?? this.isLoadingMore,
      );
}

/// Mirrors RN's `useLeaderboard` accumulate-by-offset pagination. Rebuilding
/// when `leaderboardWindowProvider` changes naturally resets the accumulated
/// list (a fresh `AsyncNotifier` state), the same as RN's own
/// `useEffect(() => setOffset(0), [window])`.
class LeaderboardController extends AsyncNotifier<LeaderboardPage> {
  @override
  Future<LeaderboardPage> build() async {
    final window = ref.watch(leaderboardWindowProvider);
    final result = await ref.watch(leaderboardRepositoryProvider).getLeaderboard(window);
    return LeaderboardPage(
      items: result.items,
      totalCount: result.totalCount,
      hasMore: result.items.length < result.totalCount,
    );
  }

  Future<void> loadMore() async {
    final current = state.value;
    if (current == null || !current.hasMore || current.isLoadingMore) return;

    state = AsyncData(current.copyWith(isLoadingMore: true));
    try {
      final window = ref.read(leaderboardWindowProvider);
      final result = await ref.read(leaderboardRepositoryProvider).getLeaderboard(
            window,
            offset: current.items.length,
          );
      // Dedupe by userId, same as RN's own `existingIds` guard.
      final existingIds = current.items.map((e) => e.userId).toSet();
      final newItems = result.items.where((e) => !existingIds.contains(e.userId));
      final items = [...current.items, ...newItems];
      state = AsyncData(LeaderboardPage(
        items: items,
        totalCount: result.totalCount,
        hasMore: items.length < result.totalCount,
      ));
    } catch (_) {
      // Stays retryable — the next scroll-to-bottom triggers another attempt.
      state = AsyncData(current.copyWith(isLoadingMore: false));
    }
  }
}

final leaderboardControllerProvider =
    AsyncNotifierProvider<LeaderboardController, LeaderboardPage>(LeaderboardController.new);
