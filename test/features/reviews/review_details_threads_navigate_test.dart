import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/data/reviews_repository.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/review_details_screen.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/thread_detail_screen.dart';

import '../../support/pump_app.dart';
import '_review_details_test_fixtures.dart';

// See `_review_details_test_fixtures.dart` for why this is one test per
// file rather than grouped with the screen's other scenarios.
void main() {
  testWidgets('tapping a thread navigates to ThreadDetailScreen', (tester) async {
    final repository = MockReviewsRepository();
    when(() => repository.getReview('rev-1')).thenAnswer((_) async => buildReview());
    when(() => repository.getGeneralComments('rev-1')).thenAnswer((_) async => []);
    when(() => repository.getThreads('rev-1')).thenAnswer(
      (_) async => (
        threads: [
          ReviewThread(
            id: 'th-1',
            comments: [
              ThreadComment(
                id: 'rc-1',
                content: 'root comment',
                createdAt: null,
                authorName: 'Jordan',
                reactions: const {},
                myReaction: null,
              ),
            ],
            commentCount: 1,
            createdBy: ReviewAuthor(id: 2, name: 'Jordan', profileImage: ''),
            message: ReviewThreadMessage(id: 'm-1', content: 'anchor text', senderId: -1),
          ),
        ],
        count: 1,
      ),
    );

    await pumpApp(
      tester,
      const ReviewDetailsScreen(reviewId: 'rev-1'),
      overrides: [reviewsRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.tap(find.text('Threads'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('anchor text'));
    await tester.pumpAndSettle();

    expect(find.byType(ThreadDetailScreen), findsOneWidget);
    expect(find.text('Comment thread'), findsOneWidget);
  });
}
