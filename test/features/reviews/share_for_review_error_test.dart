import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/reviews/data/reviews_repository.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/share_for_review_screen.dart';

import '../../support/pump_app.dart';

class MockReviewsRepository extends Mock implements ReviewsRepository {}

// One test per file — see `_review_details_test_fixtures.dart` for why.
void main() {
  testWidgets('shows an error message and re-enables the button when createReview fails',
      (tester) async {
    final repository = MockReviewsRepository();
    when(() => repository.createReview(
          scenarioSessionId: any(named: 'scenarioSessionId'),
          note: any(named: 'note'),
        )).thenAnswer((_) async => throw Exception('server down'));

    await pumpApp(
      tester,
      const ShareForReviewScreen(scenarioSessionId: 'sess-1'),
      overrides: [reviewsRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.tap(find.text('Share'));
    await tester.pumpAndSettle();

    expect(find.textContaining('Failed to share for review'), findsOneWidget);
    // The button is interactable again (not stuck in its submitting state).
    final button = tester.widget<FilledButton>(find.byType(FilledButton));
    expect(button.onPressed, isNotNull);
  });
}
