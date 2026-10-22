import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../core/permissions/permissions_repository.dart';
import '../../../core/permissions/user_permissions.dart';

/// Mirrors ally-mobile (React Native)'s `src/constants/badges.ts` enums.
enum BadgeLockStatus { locked, unlocked }

BadgeLockStatus _lockStatusFromString(String? value) =>
    value == 'UNLOCKED' ? BadgeLockStatus.unlocked : BadgeLockStatus.locked;

/// Mirrors `src/types/badges.ts`'s `Badge` — named `AchievementBadge` here
/// (not `Badge`) since that name collides with Flutter's own built-in
/// `Badge` widget in `package:flutter/material.dart`.
class AchievementBadge {
  AchievementBadge({
    required this.id,
    required this.name,
    required this.description,
    required this.imageUrl,
    required this.lockStatus,
  });

  factory AchievementBadge.fromJson(Map<String, dynamic> json) => AchievementBadge(
        id: json['id'] as String,
        name: json['name'] as String,
        description: json['description'] as String? ?? '',
        imageUrl: json['imageUrl'] as String? ?? '',
        lockStatus: _lockStatusFromString(json['lockStatus'] as String?),
      );

  final String id;
  final String name;
  final String description;
  final String imageUrl;
  final BadgeLockStatus lockStatus;
}

class BadgeCategoryGroup {
  BadgeCategoryGroup({required this.category, required this.badges});

  factory BadgeCategoryGroup.fromJson(Map<String, dynamic> json) =>
      BadgeCategoryGroup(
        category: json['category'] as String,
        badges: (json['badges'] as List<dynamic>? ?? [])
            .map((e) => AchievementBadge.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  final String category;
  final List<AchievementBadge> badges;
}

/// Ported from ally-mobile (React Native)'s `src/services/badgesApi.ts`.
/// `getAvailableBadges` (grouped, with lockStatus — what the Achievements
/// grid actually renders) hits `/badges/me/available`, distinct from the
/// flat `viewedStatus`-filtered `/badges/me` the RN app's `useBadgePopup`
/// hook polls app-wide to drive an unlock-celebration popup — that global
/// popup system is a separate, not-yet-ported feature, not just a filter
/// on this screen.
class AchievementsRepository {
  AchievementsRepository(this._dio);

  final Dio _dio;

  Future<List<BadgeCategoryGroup>> getBadges() async {
    final response = await _dio.get<List<dynamic>>('/badges/me/available');
    return (response.data ?? [])
        .map((e) => BadgeCategoryGroup.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> markBadgeAsViewed(String badgeId) async {
    await _dio.patch<void>('/badges/me/$badgeId/viewed');
  }
}

final achievementsRepositoryProvider = Provider<AchievementsRepository>((ref) {
  return AchievementsRepository(ref.watch(apiClientProvider));
});

/// RN's `useGetAvailableBadgesQuery(undefined, {skip: !hasViewBadgesPermission})`
/// — this screen is also reachable via a direct push from outside the
/// Achievements tab itself (e.g. Leaderboard's Badges button), so the tab
/// bar's own permission gate alone isn't enough to guarantee this never
/// fires for a user who lacks the permission.
final badgesProvider = FutureProvider<List<BadgeCategoryGroup>>((ref) async {
  final permissions = await ref.watch(userPermissionsProvider.future);
  if (!permissions.contains(UserPermissions.viewUserBadges)) return [];
  return ref.watch(achievementsRepositoryProvider).getBadges();
});
