import 'package:flutter/widgets.dart';

import '../../features/achievements/presentation/achievements_screen.dart';
import '../../features/analytics/presentation/user_analytics_screen.dart';
import '../../features/calllog/presentation/call_log_screen.dart';
import '../../features/community/presentation/community_screen.dart';
import '../../features/leaderboard/presentation/leaderboard_screen.dart';
import '../../features/reviews/presentation/review_screen.dart';
import '../../features/search/presentation/search_screen.dart';
import '../../features/simulations/presentation/simulations_screen.dart';
import '../permissions/user_permissions.dart';

/// Direct port of ally-mobile (React Native)'s `src/constants/tabs.tsx` —
/// same 8 tabs, same permission gates, same OR-match semantics
/// (`requiredPermissions.some(...)`, not `.every(...)`: a tab shows if the
/// signed-in user holds ANY one of its listed permissions).
class TabConfig {
  const TabConfig({
    required this.name,
    required this.requiredPermissions,
    required this.screenBuilder,
    required this.activeIconAsset,
    required this.inactiveIconAsset,
  });

  final String name;
  final List<String> requiredPermissions;
  final WidgetBuilder screenBuilder;
  final String activeIconAsset;
  final String inactiveIconAsset;
}

const String kTabLearn = 'Learn';
const String kTabCallLog = 'CallLog';
const String kTabReview = 'Review';
const String kTabUserAnalytics = 'UserAnalytics';
const String kTabLeaderboard = 'Leaderboard';
const String kTabAchievements = 'Achievements';
const String kTabSearch = 'Search';
const String kTabCommunity = 'Community';

final List<TabConfig> kTabConfig = [
  TabConfig(
    name: kTabLearn,
    requiredPermissions: const [UserPermissions.editScenarioSession],
    screenBuilder: (_) => const SimulationsScreen(),
    activeIconAsset: 'assets/icons/learnActive.svg',
    inactiveIconAsset: 'assets/icons/learn.svg',
  ),
  TabConfig(
    name: kTabCallLog,
    requiredPermissions: const [
      UserPermissions.viewCallLogs,
      UserPermissions.viewScenarioSession,
    ],
    screenBuilder: (_) => const CallLogScreen(),
    activeIconAsset: 'assets/icons/callLogActive.svg',
    inactiveIconAsset: 'assets/icons/callLog.svg',
  ),
  TabConfig(
    name: kTabReview,
    requiredPermissions: const [
      UserPermissions.viewSimulationReviews,
      UserPermissions.viewScribeReviews,
    ],
    screenBuilder: (_) => const ReviewScreen(),
    activeIconAsset: 'assets/icons/reviewActive.svg',
    inactiveIconAsset: 'assets/icons/reviewInactive.svg',
  ),
  TabConfig(
    name: kTabUserAnalytics,
    requiredPermissions: const [UserPermissions.viewAnalyticsDashboard],
    screenBuilder: (_) => const UserAnalyticsScreen(),
    activeIconAsset: 'assets/icons/analyticsActive.svg',
    inactiveIconAsset: 'assets/icons/analytics.svg',
  ),
  TabConfig(
    name: kTabLeaderboard,
    requiredPermissions: const [UserPermissions.viewCommunityLeaderboard],
    screenBuilder: (_) => const LeaderboardScreen(),
    activeIconAsset: 'assets/icons/leaderboardActive.svg',
    inactiveIconAsset: 'assets/icons/leaderboard.svg',
  ),
  TabConfig(
    name: kTabAchievements,
    requiredPermissions: const [UserPermissions.viewUserBadges],
    screenBuilder: (_) => const AchievementsScreen(),
    activeIconAsset: 'assets/icons/badgesActive.svg',
    inactiveIconAsset: 'assets/icons/badgesInactive.svg',
  ),
  TabConfig(
    name: kTabSearch,
    requiredPermissions: const [UserPermissions.viewReferenceDocument],
    screenBuilder: (_) => const SearchScreen(),
    activeIconAsset: 'assets/icons/searchActive.svg',
    inactiveIconAsset: 'assets/icons/searchInactive.svg',
  ),
  TabConfig(
    name: kTabCommunity,
    requiredPermissions: const [UserPermissions.viewCommunity],
    screenBuilder: (_) => const CommunityScreen(),
    activeIconAsset: 'assets/icons/communityActive.svg',
    inactiveIconAsset: 'assets/icons/communityInactive.svg',
  ),
];

bool _hasAnyPermission(List<String> required, List<String> permissions) {
  return required.isEmpty || required.any(permissions.contains);
}

/// Mirrors `isReviewerOnly` in `tabs.tsx`.
bool isReviewerOnly(List<String> permissions) {
  return permissions.contains(UserPermissions.viewUserBadges) &&
      !permissions.contains(UserPermissions.viewCommunityLeaderboard);
}

/// Mirrors `BottomTabs`'s own `visibleTabs` filter in `TabNavigator.tsx` —
/// note the Achievements tab gets an *extra* reviewer-only check on top of
/// its own `requiredPermissions`, applied here exactly as there.
List<TabConfig> visibleTabsFor(List<String> permissions) {
  return kTabConfig.where((tab) {
    if (!_hasAnyPermission(tab.requiredPermissions, permissions)) return false;
    if (tab.name == kTabAchievements) return isReviewerOnly(permissions);
    return true;
  }).toList();
}

/// Mirrors `getFirstVisibleTab` in `tabs.tsx` (falls back to Search).
String getFirstVisibleTab(List<String> permissions) {
  final visible = visibleTabsFor(permissions);
  return visible.isEmpty ? kTabSearch : visible.first.name;
}
