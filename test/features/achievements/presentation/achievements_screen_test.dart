import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/achievements/data/achievements_repository.dart';
import 'package:ally_mobile_flutter/features/achievements/presentation/achievements_screen.dart';

import '../../../support/pump_router_app.dart';

class MockAchievementsRepository extends Mock implements AchievementsRepository {}

List<GoRoute> _routes() => [
  GoRoute(path: '/achievements', builder: (context, state) => const AchievementsScreen()),
];

void main() {
  testWidgets(
    'AchievementsScreen: All/Unlocked filter and tap-to-mark-viewed',
    (tester) async {
      final repository = MockAchievementsRepository();
      when(() => repository.getBadges()).thenAnswer(
        (_) async => [
          BadgeCategoryGroup(
            category: 'ACTIVE_DAY_STREAK',
            badges: [
              AchievementBadge(
                id: 'b1',
                name: 'Streak 7',
                description: 'Earned by practicing 7 days in a row.',
                imageUrl: '',
                lockStatus: BadgeLockStatus.unlocked,
              ),
              AchievementBadge(
                id: 'b2',
                name: 'Streak 30',
                description: 'Earned by practicing 30 days in a row.',
                imageUrl: '',
                lockStatus: BadgeLockStatus.locked,
              ),
            ],
          ),
          // A category with nothing unlocked yet — should vanish entirely
          // from the Unlocked tab (not render as an empty section header).
          BadgeCategoryGroup(
            category: 'COMMENTS_REACTIONS_GIVEN',
            badges: [
              AchievementBadge(
                id: 'b3',
                name: 'Helper',
                description: '',
                imageUrl: '',
                lockStatus: BadgeLockStatus.locked,
              ),
            ],
          ),
        ],
      );
      when(() => repository.markBadgeAsViewed(any())).thenAnswer((_) async {});

      await pumpRouterApp(
        tester,
        initialLocation: '/achievements',
        routes: _routes(),
        overrides: [achievementsRepositoryProvider.overrideWithValue(repository)],
      );

      // No back arrow when this is the root route (nothing to pop to) —
      // e.g. reached as the Achievements bottom tab, not pushed from
      // elsewhere.
      expect(find.byIcon(Icons.arrow_back), findsNothing);

      // --- All tab (default): every badge from every category shows, ---
      // --- each with its RN-real translated category label (mapped   ---
      // --- from the raw backend category via BADGE_CATEGORY_MAP) and ---
      // --- its description text (not just an icon+name grid tile).   ---
      expect(find.text('Momentum'), findsOneWidget);
      expect(find.text('Contribution'), findsOneWidget);
      expect(find.text('Streak 7'), findsOneWidget);
      expect(find.text('Earned by practicing 7 days in a row.'), findsOneWidget);
      expect(find.text('Streak 30'), findsOneWidget);
      expect(find.text('Helper'), findsOneWidget);

      // --- The top "Badges" label and each category both expose an   ---
      // --- info tooltip (one for the label, one per category shown). ---
      expect(find.text('Badges'), findsOneWidget);
      expect(find.byTooltip('Badges are earned based on your activity across simulations and community participation. Some badges may be removed if qualifying actions are undone.'), findsOneWidget);
      expect(find.byIcon(Icons.info_outline), findsNWidgets(3), reason: 'the Badges label + one per category');

      // --- Switch to Unlocked: locked badges disappear, and a category ---
      // --- left with nothing unlocked disappears entirely.             ---
      await tester.tap(find.text('Unlocked'));
      await tester.pumpAndSettle();

      expect(find.text('Streak 7'), findsOneWidget, reason: 'unlocked badge stays');
      expect(find.text('Streak 30'), findsNothing, reason: 'locked badge is filtered out');
      expect(find.text('Contribution'), findsNothing, reason: 'category with nothing unlocked is dropped');
      expect(find.text('Helper'), findsNothing);

      // --- Tapping a badge marks it viewed, regardless of filter. ---
      await tester.tap(find.text('Streak 7'));
      await tester.pumpAndSettle();

      verify(() => repository.markBadgeAsViewed('b1')).called(1);

      // --- Back to All: everything reappears. ---
      await tester.tap(find.text('All'));
      await tester.pumpAndSettle();

      expect(find.text('Streak 30'), findsOneWidget);
      expect(find.text('Contribution'), findsOneWidget);

      // --- A fresh mount whose repository throws shows an error message. ---
      // (Combined into this same test body — see pumpApp's doc comment in
      // test/support/pump_app.dart on why a second, separate `testWidgets`
      // in this file reliably fails to load translations; pumpRouterApp
      // uses a different, synchronous translations override so this isn't
      // at risk the same way, but keeping the sequential-steps shape.)
      final failingRepository = MockAchievementsRepository();
      when(() => failingRepository.getBadges()).thenThrow(Exception('boom'));

      await pumpRouterApp(
        tester,
        initialLocation: '/achievements',
        routes: _routes(),
        overrides: [achievementsRepositoryProvider.overrideWithValue(failingRepository)],
      );

      expect(find.textContaining('Unable to Load Achievements'), findsOneWidget);
    },
  );

  testWidgets('shows a back arrow that pops when reached via a direct push', (tester) async {
    final repository = MockAchievementsRepository();
    when(() => repository.getBadges()).thenAnswer((_) async => []);

    final router = await pumpRouterApp(
      tester,
      initialLocation: '/leaderboard',
      routes: [
        GoRoute(path: '/leaderboard', builder: (context, state) => const Scaffold(body: Text('LEADERBOARD'))),
        ..._routes(),
      ],
      overrides: [achievementsRepositoryProvider.overrideWithValue(repository)],
    );
    router.push('/achievements');
    await tester.pumpAndSettle();

    await tester.tap(find.byIcon(Icons.arrow_back));
    await tester.pumpAndSettle();

    expect(find.text('LEADERBOARD'), findsOneWidget);
  });
}
