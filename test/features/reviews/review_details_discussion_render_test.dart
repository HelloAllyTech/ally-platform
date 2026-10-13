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
  testWidgets('Discussion tab shows the review note/author and the comment list', (tester) async {
    final repository = MockReviewsRepository();
    when(() => repository.getReview('rev-1')).thenAnswer((_) async => buildReview());
    when(() => repository.getGeneralComments('rev-1')).thenAnswer(
      (_) async => [
        ReviewComment(id: 'c-1', content: 'Great session', createdAt: null, authorName: 'Sam'),
      ],
    );
    when(() => repository.getThreads('rev-1'))
        .thenAnswer((_) async => (threads: <ReviewThread>[], count: 0));

    await pumpApp(
      tester,
      const ReviewDetailsScreen(reviewId: 'rev-1'),
      overrides: [reviewsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.text('Dr. Patel'), findsOneWidget);
    expect(find.text('please look at this session'), findsOneWidget);
    expect(find.text('Sam'), findsOneWidget);
    expect(find.text('Great session'), findsOneWidget);
  });
}
