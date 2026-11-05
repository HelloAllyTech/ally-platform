import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'package:ally_mobile_flutter/core/navigation/home_tab_navigation.dart';
import 'package:ally_mobile_flutter/core/navigation/tab_config.dart';
import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';
import 'package:ally_mobile_flutter/features/progress/data/progress_repository.dart';
import 'package:ally_mobile_flutter/features/progress/presentation/progress_screen.dart';

import '../../../support/fake_translations.dart';
import '../../../support/pump_app.dart';
import '../../../support/pump_router_app.dart';

ProgressDashboard _dashboard({bool isMaxLevel = false}) => ProgressDashboard(
  level: 4,
  totalXp: 640,
  xpIntoLevel: 124,
  xpToNextLevel: isMaxLevel ? null : 286,
  nextLevelXp: isMaxLevel ? null : 926,
  progress: isMaxLevel ? 1.0 : 0.3,
  isMaxLevel: isMaxLevel,
  lifetimePracticeMinutes: 412,
  sessionsCompleted: 37,
  trackItemsCompleted: 12,
  ladder: const [],
);

void main() {
  testWidgets('renders the hero, stats grid, and link cards once the dashboard resolves', (
    tester,
  ) async {
    await pumpApp(
      tester,
      const ProgressScreen(),
      overrides: [
        progressDashboardProvider.overrideWith((ref) async => _dashboard()),
        fixedTranslationsOverride(),
      ],
    );

    expect(find.text('4'), findsOneWidget, reason: 'level ring');
    expect(find.text('412'), findsOneWidget);
    expect(find.text('37'), findsOneWidget);
    expect(find.text('12'), findsOneWidget);
  });

  testWidgets('shows the max-level caption instead of an XP-to-next-level count at the top', (
    tester,
  ) async {
    await pumpApp(
      tester,
      const ProgressScreen(),
      overrides: [
        progressDashboardProvider.overrideWith((ref) async => _dashboard(isMaxLevel: true)),
        fixedTranslationsOverride(),
      ],
    );

    expect(find.text("You've reached the top level"), findsOneWidget);
  });

  testWidgets('shows the error description when the dashboard fails to load', (tester) async {
    await pumpApp(
      tester,
      const ProgressScreen(),
      overrides: [
        progressDashboardProvider.overrideWith((ref) async => throw Exception('boom')),
        fixedTranslationsOverride(),
      ],
    );

    expect(
      find.text('Something went wrong fetching your progress. Pull down to try again.'),
      findsOneWidget,
    );
  });

  testWidgets('rank link jumps to the Leaderboard tab; badges link pushes Achievements', (tester) async {
    final router = await pumpRouterApp(
      tester,
      initialLocation: '/progress',
      routes: [
        GoRoute(path: '/progress', builder: (context, state) => const ProgressScreen()),
        GoRoute(
          path: '/home',
          builder: (context, state) => Text('HOME ${(state.extra as HomeTabRequest?)?.tabName}'),
        ),
        GoRoute(path: '/achievements', builder: (context, state) => const Text('ACHIEVEMENTS')),
      ],
      overrides: [
        progressDashboardProvider.overrideWith((ref) async => _dashboard()),
        userPermissionsProvider.overrideWith((ref) async => [UserPermissions.viewCommunityLeaderboard]),
      ],
    );

    await tester.tap(find.byKey(const Key('progress-badges-link')));
    await tester.pumpAndSettle();
    expect(find.text('ACHIEVEMENTS'), findsOneWidget);
    router.pop();
    await tester.pumpAndSettle();

    await tester.tap(find.text('See where you rank'));
    await tester.pumpAndSettle();
    expect(find.text('HOME $kTabLeaderboard'), findsOneWidget);
  });

  testWidgets('without the leaderboard permission the rank link does nothing; closed gate still shows both links', (
    tester,
  ) async {
    await pumpRouterApp(
      tester,
      initialLocation: '/progress',
      routes: [
        GoRoute(path: '/progress', builder: (context, state) => const ProgressScreen()),
        GoRoute(path: '/home', builder: (context, state) => const Text('HOME')),
      ],
      overrides: [
        progressDashboardProvider.overrideWith((ref) async => null),
        userPermissionsProvider.overrideWith((ref) async => const <String>[]),
      ],
    );

    expect(find.text('See all your badges'), findsOneWidget);
    await tester.tap(find.text('See where you rank'));
    await tester.pumpAndSettle();
    expect(find.text('HOME'), findsNothing);
    expect(find.byType(ProgressScreen), findsOneWidget);
  });
}
