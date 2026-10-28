import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../core/permissions/permissions_repository.dart';
import '../../../core/permissions/user_permissions.dart';

/// Mirrors ally-mobile (React Native)'s `src/types/progress.ts`
/// `ProgressSummary` — level state without the dashboard payload, served by
/// its own endpoint so the always-mounted header widget and the Progress
/// screen share one cache entry rather than each fetching the heavier
/// dashboard response.
class ProgressSummary {
  ProgressSummary({
    required this.level,
    required this.totalXp,
    required this.xpIntoLevel,
    required this.xpToNextLevel,
    required this.nextLevelXp,
    required this.progress,
    required this.isMaxLevel,
  });

  factory ProgressSummary.fromJson(Map<String, dynamic> json) => ProgressSummary(
    level: (json['level'] as num).toInt(),
    totalXp: (json['totalXp'] as num).toInt(),
    xpIntoLevel: (json['xpIntoLevel'] as num).toInt(),
    xpToNextLevel: (json['xpToNextLevel'] as num?)?.toInt(),
    nextLevelXp: (json['nextLevelXp'] as num?)?.toInt(),
    progress: (json['progress'] as num).toDouble(),
    isMaxLevel: json['isMaxLevel'] as bool? ?? false,
  );

  final int level;
  final int totalXp;
  final int xpIntoLevel;

  /// Null once the learner is at the top of the ladder.
  final int? xpToNextLevel;
  final int? nextLevelXp;

  /// 0-1. Always 1 at max level, so a full ring reads as "topped out".
  final double progress;
  final bool isMaxLevel;
}

class LevelThreshold {
  LevelThreshold({required this.level, required this.requiredXp});

  factory LevelThreshold.fromJson(Map<String, dynamic> json) => LevelThreshold(
    level: (json['level'] as num).toInt(),
    requiredXp: (json['requiredXp'] as num).toInt(),
  );

  final int level;
  final int requiredXp;
}

/// Mirrors `ProgressResponse` — the full dashboard payload the Progress
/// screen itself renders.
class ProgressDashboard extends ProgressSummary {
  ProgressDashboard({
    required super.level,
    required super.totalXp,
    required super.xpIntoLevel,
    required super.xpToNextLevel,
    required super.nextLevelXp,
    required super.progress,
    required super.isMaxLevel,
    required this.lifetimePracticeMinutes,
    required this.sessionsCompleted,
    required this.trackItemsCompleted,
    required this.ladder,
  });

  factory ProgressDashboard.fromJson(Map<String, dynamic> json) => ProgressDashboard(
    level: (json['level'] as num).toInt(),
    totalXp: (json['totalXp'] as num).toInt(),
    xpIntoLevel: (json['xpIntoLevel'] as num).toInt(),
    xpToNextLevel: (json['xpToNextLevel'] as num?)?.toInt(),
    nextLevelXp: (json['nextLevelXp'] as num?)?.toInt(),
    progress: (json['progress'] as num).toDouble(),
    isMaxLevel: json['isMaxLevel'] as bool? ?? false,
    lifetimePracticeMinutes: (json['lifetimePracticeMinutes'] as num?)?.toInt() ?? 0,
    sessionsCompleted: (json['sessionsCompleted'] as num?)?.toInt() ?? 0,
    trackItemsCompleted: (json['trackItemsCompleted'] as num?)?.toInt() ?? 0,
    ladder: (json['ladder'] as List<dynamic>? ?? [])
        .map((e) => LevelThreshold.fromJson(e as Map<String, dynamic>))
        .toList(),
  );

  final int lifetimePracticeMinutes;
  final int sessionsCompleted;
  final int trackItemsCompleted;

  /// The whole ladder, served so the client never hardcodes thresholds that
  /// could drift — not currently consumed by the ported screen, kept for
  /// parity with the real response shape.
  final List<LevelThreshold> ladder;
}

/// Ported from ally-mobile (React Native)'s `src/services/progressApi.ts`.
class ProgressRepository {
  ProgressRepository(this._dio);

  final Dio _dio;

  Future<ProgressSummary> getProgressSummary() async {
    final response = await _dio.get<Map<String, dynamic>>('/progress/me/summary');
    return ProgressSummary.fromJson(response.data!);
  }

  Future<ProgressDashboard> getProgress() async {
    final response = await _dio.get<Map<String, dynamic>>('/progress/me');
    return ProgressDashboard.fromJson(response.data!);
  }

  /// Own-org toggle. Any authenticated user may read it; no permission
  /// required.
  Future<bool> getProgressEnabled() async {
    final response = await _dio.get<bool>('/progress/me/enabled');
    return response.data ?? false;
  }
}

final progressRepositoryProvider = Provider<ProgressRepository>((ref) {
  return ProgressRepository(ref.watch(apiClientProvider));
});

final progressEnabledProvider = FutureProvider<bool>((ref) {
  return ref.watch(progressRepositoryProvider).getProgressEnabled();
});

/// Mirrors `useProgressSummary`'s `canViewProgress` — two gates, both
/// required. The permission is what the API enforces on the data; the org
/// toggle decides whether this organisation has the feature at all. A
/// permission-only check would light the widget up for tenants that never
/// opted in, since every learner holds `viewUserRank`.
final canViewProgressProvider = FutureProvider<bool>((ref) async {
  final permissions = await ref.watch(userPermissionsProvider.future);
  if (!permissions.contains(UserPermissions.viewUserRank)) return false;
  return ref.watch(progressEnabledProvider.future);
});

/// Shared by the persistent header widget and the Progress screen — same
/// provider instance means one cache entry and one in-flight request no
/// matter how many screens mount it, same as RN's single RTK Query cache
/// key for this no-argument endpoint.
final progressSummaryProvider = FutureProvider<ProgressSummary?>((ref) async {
  final canView = await ref.watch(canViewProgressProvider.future);
  if (!canView) return null;
  return ref.watch(progressRepositoryProvider).getProgressSummary();
});

/// RN `refetchOnMountOrArgChange: true`: dropped when the Progress screen
/// closes, so every visit fetches fresh.
final progressDashboardProvider = FutureProvider.autoDispose<ProgressDashboard?>((ref) async {
  final canView = await ref.watch(canViewProgressProvider.future);
  if (!canView) return null;
  return ref.watch(progressRepositoryProvider).getProgress();
});
