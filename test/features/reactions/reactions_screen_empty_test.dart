import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/reactions/data/reactions_repository.dart';
import 'package:ally_mobile_flutter/features/reactions/presentation/reactions_screen.dart';

import '../../support/pump_app.dart';

class MockReactionsRepository extends Mock implements ReactionsRepository {}

// One test per file — see `_review_details_test_fixtures.dart` for why.
void main() {
  testWidgets('shows an empty state and hides the counts row when there are no reactions yet',
      (tester) async {
    final repository = MockReactionsRepository();
    when(() => repository.getReactions('rev-1')).thenAnswer((_) async => []);
    when(() => repository.getReactionsCount('rev-1')).thenAnswer((_) async => {});

    await pumpApp(
      tester,
      const ReactionsScreen(reviewId: 'rev-1'),
      overrides: [reactionsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.text('No reactions yet'), findsOneWidget);
  });
}
