import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'package:ally_mobile_flutter/features/progress/data/progress_repository.dart';
import 'package:ally_mobile_flutter/features/progress/presentation/progress_header_widget.dart';

import '../../../support/pump_app.dart';

ProgressSummary _summary({int level = 3, double progress = 0.4, bool isMaxLevel = false}) =>
    ProgressSummary(
      level: level,
      totalXp: 300,
      xpIntoLevel: 40,
      xpToNextLevel: isMaxLevel ? null : 60,
      nextLevelXp: isMaxLevel ? null : 400,
      progress: progress,
      isMaxLevel: isMaxLevel,
    );

void main() {
  testWidgets('renders nothing while the summary has not resolved', (tester) async {
    await pumpApp(
      tester,
      const Scaffold(body: ProgressHeaderWidget()),
      overrides: [progressSummaryProvider.overrideWith((ref) async => null)],
    );

    expect(find.byKey(const ValueKey('level-indicator')), findsNothing);
  });

  testWidgets('renders nothing when hideProgressWidget (ProgressScreen\'s own header) is set', (
    tester,
  ) async {
    await pumpApp(
      tester,
      const Scaffold(body: ProgressHeaderWidget(isOnProgressScreen: true)),
      overrides: [progressSummaryProvider.overrideWith((ref) async => _summary())],
    );

    expect(find.byKey(const ValueKey('level-indicator')), findsNothing);
  });

  testWidgets('renders the level ring once the summary resolves, and tapping it opens /progress', (
    tester,
  ) async {
    await pumpRoutedApp(
      tester,
      initialLocation: '/home',
      routes: [
        GoRoute(
          path: '/home',
          builder: (context, state) => const Scaffold(body: ProgressHeaderWidget()),
        ),
        GoRoute(path: '/progress', builder: (context, state) => const Text('PROGRESS SCREEN')),
      ],
      overrides: [progressSummaryProvider.overrideWith((ref) async => _summary(level: 5))],
    );

    expect(find.byKey(const ValueKey('level-indicator')), findsOneWidget);
    expect(find.text('5'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('level-indicator')));
    await tester.pumpAndSettle();

    expect(find.text('PROGRESS SCREEN'), findsOneWidget);
  });
}
