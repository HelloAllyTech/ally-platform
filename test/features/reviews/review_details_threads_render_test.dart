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
  testWidgets('Threads tab renders anchor message, root comment preview and reply count',
      (tester) async {
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
                content: 'I think this went well',
                createdAt: null,
                authorName: 'Jordan',
                reactions: const {},
                myReaction: null,
              ),
            ],
            commentCount: 4,
            createdBy: ReviewAuthor(id: 2, name: 'Jordan', profileImage: ''),
            message: ReviewThreadMessage(id: 'm-1', content: 'I felt anxious', senderId: -1),
          ),
          ReviewThread(
            id: 'th-2',
            comments: const [],
            commentCount: 0,
            createdBy: ReviewAuthor(id: 3, name: 'Alex', profileImage: ''),
            message: null,
          ),
        ],
        count: 2,
      ),
    );

    await pumpApp(
      tester,
      const ReviewDetailsScreen(reviewId: 'rev-1'),
      overrides: [reviewsRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.tap(find.text('Threads'));
    await tester.pumpAndSettle();

    expect(find.text('I felt anxious'), findsOneWidget);
    expect(find.text('Jordan: I think this went well'), findsOneWidget);
    expect(find.text('4'), findsOneWidget);
    expect(find.text('(transcript moment)'), findsOneWidget);
    expect(find.text('0'), findsOneWidget);
  });
}
