import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/reactions/data/reactions_repository.dart';
import 'package:ally_mobile_flutter/features/reactions/presentation/reactions_screen.dart';

import '../../support/pump_app.dart';

class MockReactionsRepository extends Mock implements ReactionsRepository {}

// One test per file, same as the review-feature widget tests in this
// directory — see `_review_details_test_fixtures.dart` for why.
void main() {
  testWidgets(
    'excludes a zero-count reaction type from the filter tabs, matching RN '
    "(a stray type with every reaction removed shouldn't show an empty '0' tab)",
    (tester) async {
      final repository = MockReactionsRepository();
      when(() => repository.getReactions('rev-1', offset: 0, reaction: null)).thenAnswer(
        (_) async => ReactionsPage(
          items: [
          Reaction(reaction: '1f44d', createdBy: ReactionUser(id: '1', name: 'Alex', profileImage: null)),
        ],
          total: 1,
        ),
      );
      when(() => repository.getReactionsCount('rev-1')).thenAnswer(
        (_) async => {'1f44d': 1, '2764-fe0f': 0},
      );

      await pumpApp(
        tester,
        const ReactionsScreen(reviewId: 'rev-1'),
        overrides: [reactionsRepositoryProvider.overrideWithValue(repository)],
      );

      expect(find.text('All 1'), findsOneWidget);
      expect(find.textContaining('👍'), findsWidgets);
      expect(find.textContaining('❤️'), findsNothing, reason: 'no tab for the 0-count type');
    },
  );
}
