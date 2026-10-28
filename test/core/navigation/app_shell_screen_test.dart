import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/navigation/app_bottom_tab_bar.dart';
import 'package:ally_mobile_flutter/core/navigation/app_shell_screen.dart';
import 'package:ally_mobile_flutter/core/navigation/home_tab_navigation.dart';
import 'package:ally_mobile_flutter/core/navigation/tab_config.dart';
import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';
import 'package:ally_mobile_flutter/core/push/push_notification_service.dart';
import 'package:ally_mobile_flutter/core/routing/app_router.dart';
import 'package:ally_mobile_flutter/features/achievements/data/achievements_repository.dart';
import 'package:ally_mobile_flutter/features/notifications/data/notifications_repository.dart';
import 'package:ally_mobile_flutter/features/reviews/data/reviews_repository.dart';

import '../../support/fake_translations.dart';

class MockAchievementsRepository extends Mock implements AchievementsRepository {}

class MockNotificationsRepository extends Mock implements NotificationsRepository {}

class _NoopPushService extends PushNotificationService {
  @override
  Future<void> initializeAndRegister(NotificationsRepository repository, GoRouter router) async {}
}

/// Reviewer-only account: Achievements (first visible tab) + Search.
const _permissions = [UserPermissions.viewUserBadges, UserPermissions.viewReferenceDocument];

void main() {
  late MockAchievementsRepository achievements;

  setUp(() {
    achievements = MockAchievementsRepository();
    when(() => achievements.getBadges()).thenAnswer((_) async => []);
    when(() => achievements.getUnviewedBadges()).thenAnswer((_) async => []);
  });

  Future<GoRouter> pumpShell(WidgetTester tester) async {
    late GoRouter router;
    router = GoRouter(
      initialLocation: '/home',
      routes: [
        GoRoute(
          path: '/home',
          builder: (context, state) => AppShellScreen(
            tabRequest: state.extra is HomeTabRequest ? state.extra as HomeTabRequest : null,
          ),
        ),
      ],
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          fixedTranslationsOverride(),
          userPermissionsProvider.overrideWith((ref) async => _permissions),
          unreadReviewCountProvider.overrideWith((ref) async => 0),
          pushNotificationServiceProvider.overrideWithValue(_NoopPushService()),
          notificationsRepositoryProvider.overrideWithValue(MockNotificationsRepository()),
          appRouterProvider.overrideWithValue(router),
          achievementsRepositoryProvider.overrideWithValue(achievements),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();
    return router;
  }

  PopScope<Object?> shellPopScope(WidgetTester tester) => tester.widget<PopScope<Object?>>(
        find.ancestor(of: find.byType(AppBottomTabBar), matching: find.byWidgetPredicate((w) => w is PopScope)).first,
      );

  int currentTab(WidgetTester tester) => tester.widget<AppBottomTabBar>(find.byType(AppBottomTabBar)).currentIndex;

  testWidgets('goToHomeTab selects the tab; Android back goes to the first tab, then may leave', (tester) async {
    final router = await pumpShell(tester);
    expect(currentTab(tester), 0, reason: 'first visible tab (Achievements)');

    goToHomeTab(router, kTabSearch);
    await tester.pumpAndSettle();
    expect(currentTab(tester), 1);

    // RN useTabBackToHomeHandler: back on a non-first tab root -> first tab.
    expect(shellPopScope(tester).canPop, isFalse);
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(currentTab(tester), 0);

    // On the first tab back is no longer intercepted (RN BackHandler.exitApp).
    expect(shellPopScope(tester).canPop, isTrue);

    // Asking again for the same tab still switches to it.
    goToHomeTab(router, kTabSearch);
    await tester.pumpAndSettle();
    expect(currentTab(tester), 1);

    // A tab this user can't see falls back to the first visible tab.
    goToHomeTab(router, kTabLeaderboard);
    await tester.pumpAndSettle();
    expect(currentTab(tester), 0);
  });
}
