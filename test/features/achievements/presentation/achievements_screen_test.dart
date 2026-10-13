import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/achievements/data/achievements_repository.dart';
import 'package:ally_mobile_flutter/features/achievements/presentation/achievements_screen.dart';

import '../../../support/pump_app.dart';

class MockAchievementsRepository extends Mock implements AchievementsRepository {}

void main() {
  testWidgets(
    'AchievementsScreen: All/Unlocked filter and tap-to-mark-viewed',
    (tester) async {
      final repository = MockAchievementsRepository();
      when(() => repository.getBadges()).thenAnswer(
        (_) async => [
          BadgeCategoryGroup(
            category: 'Momentum',
            badges: [
              AchievementBadge(
                id: 'b1',
                name: 'Streak 7',
                description: '',
                imageUrl: '',
                lockStatus: BadgeLockStatus.unlocked,
              ),
              AchievementBadge(
                id: 'b2',
                name: 'Streak 30',
                description: '',
                imageUrl: '',
                lockStatus: BadgeLockStatus.locked,
              ),
            ],
          ),
          // A category with nothing unlocked yet — should vanish entirely
          // from the Unlocked tab (not render as an empty section header).
          BadgeCategoryGroup(
            category: 'Contribution',
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

      await pumpApp(
        tester,
        const AchievementsScreen(),
        overrides: [achievementsRepositoryProvider.overrideWithValue(repository)],
      );

      // --- All tab (default): every badge from every category shows. ---
      expect(find.text('Momentum'), findsOneWidget);
      expect(find.text('Contribution'), findsOneWidget);
      expect(find.text('Streak 7'), findsOneWidget);
      expect(find.text('Streak 30'), findsOneWidget);
      expect(find.text('Helper'), findsOneWidget);

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
      // in this file reliably fails to load translations.)
      final failingRepository = MockAchievementsRepository();
      when(() => failingRepository.getBadges()).thenThrow(Exception('boom'));

      await pumpApp(
        tester,
        const AchievementsScreen(),
        overrides: [achievementsRepositoryProvider.overrideWithValue(failingRepository)],
      );

      expect(find.textContaining('Unable to Load Achievements'), findsOneWidget);
    },
  );
}
