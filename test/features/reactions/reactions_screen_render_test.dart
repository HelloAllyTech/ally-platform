import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/reactions/data/reactions_repository.dart';
import 'package:ally_mobile_flutter/features/reactions/presentation/reactions_screen.dart';

import '../../support/pump_app.dart';

class MockReactionsRepository extends Mock implements ReactionsRepository {}

// One test per file, same as the review-feature widget tests in this
// directory — see `_review_details_test_fixtures.dart` for why.
void main() {
  testWidgets('renders the who-reacted list and the aggregate reaction counts', (tester) async {
    final repository = MockReactionsRepository();
    when(() => repository.getReactions('rev-1')).thenAnswer(
      (_) async => [
        Reaction(
          reaction: '👍',
          createdBy: ReactionUser(id: '1', name: 'Alex', profileImage: null),
        ),
        Reaction(
          reaction: '❤️',
          createdBy: ReactionUser(id: '2', name: 'Sam', profileImage: null),
        ),
      ],
    );
    when(() => repository.getReactionsCount('rev-1'))
        .thenAnswer((_) async => {'👍': 1, '❤️': 1});

    await pumpApp(
      tester,
      const ReactionsScreen(reviewId: 'rev-1'),
      overrides: [reactionsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.text('Alex'), findsOneWidget);
    expect(find.text('Sam'), findsOneWidget);
    expect(find.text('👍 1'), findsOneWidget);
    expect(find.text('❤️ 1'), findsOneWidget);
  });
}
