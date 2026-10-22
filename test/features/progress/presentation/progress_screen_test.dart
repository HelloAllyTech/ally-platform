import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

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

  testWidgets('tapping the leaderboard/badges link cards navigates there', (tester) async {
    final router = await pumpRouterApp(
      tester,
      initialLocation: '/progress',
      routes: [
        GoRoute(path: '/progress', builder: (context, state) => const ProgressScreen()),
        GoRoute(path: '/leaderboard', builder: (context, state) => const Text('LEADERBOARD')),
        GoRoute(path: '/achievements', builder: (context, state) => const Text('ACHIEVEMENTS')),
      ],
      overrides: [progressDashboardProvider.overrideWith((ref) async => _dashboard())],
    );

    await tester.tap(find.text('See where you rank'));
    await tester.pumpAndSettle();
    expect(find.text('LEADERBOARD'), findsOneWidget);

    router.pop();
    await tester.pumpAndSettle();
    await tester.tap(find.text('See all your badges'));
    await tester.pumpAndSettle();
    expect(find.text('ACHIEVEMENTS'), findsOneWidget);
  });
}
