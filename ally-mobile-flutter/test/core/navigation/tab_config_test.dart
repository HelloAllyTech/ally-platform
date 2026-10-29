import 'package:ally_mobile_flutter/core/navigation/tab_config.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('visibleTabsFor', () {
    test('includes a tab when the user holds any one of its required permissions', () {
      final visible = visibleTabsFor([UserPermissions.viewCommunity]);
      expect(visible.map((t) => t.name), contains(kTabCommunity));
    });

    test('excludes a tab when none of its required permissions are held', () {
      final visible = visibleTabsFor([]);
      expect(visible.map((t) => t.name), isNot(contains(kTabCommunity)));
    });

    test('CallLog shows with either of its two OR-matched permissions', () {
      expect(
        visibleTabsFor([UserPermissions.viewCallLogs]).map((t) => t.name),
        contains(kTabCallLog),
      );
      expect(
        visibleTabsFor([UserPermissions.viewScenarioSession]).map((t) => t.name),
        contains(kTabCallLog),
      );
    });

    test(
      'Achievements is hidden even with viewUserBadges when the user also has leaderboard access',
      () {
        final visible = visibleTabsFor([
          UserPermissions.viewUserBadges,
          UserPermissions.viewCommunityLeaderboard,
        ]);
        expect(visible.map((t) => t.name), isNot(contains(kTabAchievements)));
      },
    );

    test('Achievements shows only for reviewer-only accounts (badges but no leaderboard)', () {
      final visible = visibleTabsFor([UserPermissions.viewUserBadges]);
      expect(visible.map((t) => t.name), contains(kTabAchievements));
    });
  });

  group('isReviewerOnly', () {
    test('true when the account has badge access but not leaderboard access', () {
      expect(isReviewerOnly([UserPermissions.viewUserBadges]), isTrue);
    });

    test('false when the account has both', () {
      expect(
        isReviewerOnly([
          UserPermissions.viewUserBadges,
          UserPermissions.viewCommunityLeaderboard,
        ]),
        isFalse,
      );
    });

    test('false when the account has neither', () {
      expect(isReviewerOnly([]), isFalse);
    });
  });

  group('getFirstVisibleTab', () {
    test('returns the first tab (in TAB_CONFIG order) the user can see', () {
      expect(
        getFirstVisibleTab([UserPermissions.viewCommunityLeaderboard]),
        kTabLeaderboard,
      );
    });

    test('falls back to Search when no tab is visible', () {
      expect(getFirstVisibleTab([]), kTabSearch);
    });
  });
}
