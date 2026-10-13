import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/reactions/data/reactions_repository.dart';
import 'package:ally_mobile_flutter/features/reactions/presentation/reactions_screen.dart';

import '../../support/pump_app.dart';

class MockReactionsRepository extends Mock implements ReactionsRepository {}

// One test per file — see `_review_details_test_fixtures.dart` for why.
void main() {
  testWidgets('tapping an emoji calls addReactionToReview and refreshes the list and counts',
      (tester) async {
    final repository = MockReactionsRepository();
    var callCount = 0;
    when(() => repository.getReactions('rev-1')).thenAnswer((_) async {
      callCount++;
      if (callCount == 1) return [];
      return [
        Reaction(reaction: '🎉', createdBy: ReactionUser(id: '1', name: 'Alex', profileImage: null)),
      ];
    });
    when(() => repository.getReactionsCount('rev-1')).thenAnswer((_) async {
      return callCount <= 1 ? {} : {'🎉': 1};
    });
    when(() => repository.addReactionToReview(
          reviewId: 'rev-1',
          reaction: '🎉',
          action: ReactionAction.add,
        )).thenAnswer((_) async {});

    await pumpApp(
      tester,
      const ReactionsScreen(reviewId: 'rev-1'),
      overrides: [reactionsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.text('No reactions yet'), findsOneWidget);

    await tester.tap(find.text('🎉'));
    await tester.pumpAndSettle();

    verify(() => repository.addReactionToReview(
          reviewId: 'rev-1',
          reaction: '🎉',
          action: ReactionAction.add,
        )).called(1);
    expect(find.text('Alex'), findsOneWidget);
    expect(find.text('🎉 1'), findsOneWidget);
  });
}
