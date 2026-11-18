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

/// RN `types/badges.ts` `UserBadge`: an earned badge as `/badges/me`
/// lists it. [badgeId] is what `PATCH /badges/me/:id/viewed` takes.
class UserBadge {
  UserBadge({
    required this.id,
    required this.badgeId,
    required this.name,
    required this.description,
    required this.imageUrl,
  });

  factory UserBadge.fromJson(Map<String, dynamic> json) => UserBadge(
        id: json['id'].toString(),
        badgeId: json['badgeId'].toString(),
        name: json['name'] as String? ?? '',
        description: json['description'] as String? ?? '',
        imageUrl: json['imageUrl'] as String? ?? '',
      );

  final String id;
  final String badgeId;
  final String name;
  final String description;
  final String imageUrl;
}

/// Ported from ally-mobile (React Native)'s `src/services/badgesApi.ts`.
/// `getAvailableBadges` (grouped, with lockStatus — what the Achievements
/// grid actually renders) hits `/badges/me/available`; `getUnviewedBadges`
/// is the flat `viewedStatus`-filtered `/badges/me` that RN's
/// `useBadgePopup` polls for the unlock popup (`badge_popup.dart`).
class AchievementsRepository {
  AchievementsRepository(this._dio);

  final Dio _dio;

  Future<List<BadgeCategoryGroup>> getBadges() async {
    final response = await _dio.get<List<dynamic>>('/badges/me/available');
    return (response.data ?? [])
        .map((e) => BadgeCategoryGroup.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// RN `getBadges({viewedStatus: UNVIEWED})`: `GET /badges/me`.
  Future<List<UserBadge>> getUnviewedBadges() async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/badges/me',
      queryParameters: {'viewedStatus': 'UNVIEWED'},
    );
    return (response.data?['data'] as List<dynamic>? ?? [])
        .map((e) => UserBadge.fromJson(e as Map<String, dynamic>))
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
