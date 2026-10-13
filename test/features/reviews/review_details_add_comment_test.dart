import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/data/reviews_repository.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/review_details_screen.dart';

import '../../support/pump_app.dart';
import '_review_details_test_fixtures.dart';

// See `_review_details_test_fixtures.dart` for why this is one test per
// file rather than grouped with the screen's other scenarios.
void main() {
  testWidgets('adding a comment calls addGeneralComment, clears the input and refreshes the list',
      (tester) async {
    final repository = MockReviewsRepository();
    when(() => repository.getReview('rev-1')).thenAnswer((_) async => buildReview());
    when(() => repository.getThreads('rev-1'))
        .thenAnswer((_) async => (threads: <ReviewThread>[], count: 0));

    var callCount = 0;
    when(() => repository.getGeneralComments('rev-1')).thenAnswer((_) async {
      callCount++;
      if (callCount == 1) return [];
      return [ReviewComment(id: 'c-new', content: 'nice work', createdAt: null, authorName: 'Me')];
    });
    when(() => repository.addGeneralComment(reviewId: 'rev-1', content: 'nice work'))
        .thenAnswer((_) async {});

    await pumpApp(
      tester,
      const ReviewDetailsScreen(reviewId: 'rev-1'),
      overrides: [reviewsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.text('No comments yet'), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'nice work');
    await tester.tap(find.byIcon(Icons.send));
    await tester.pumpAndSettle();

    verify(() => repository.addGeneralComment(reviewId: 'rev-1', content: 'nice work')).called(1);
    expect(find.text('nice work'), findsOneWidget);
    expect(find.text('Me'), findsOneWidget);

    final textField = tester.widget<TextField>(find.byType(TextField));
    expect(textField.controller!.text, isEmpty);
  });
}
