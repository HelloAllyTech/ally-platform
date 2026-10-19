import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/widgets/review_type_chip.dart';
import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/data/scribe_reviews_repository.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/review_details_screen.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/thread_detail_screen.dart';

import '../../support/pump_app.dart';

class MockScribeReviewsRepository extends Mock implements ScribeReviewsRepository {}

/// `ReviewDetailsScreen(reviewType: ReviewType.scribe)` end to end —
/// closes the gap `review_screen.dart` used to flag ("No
/// ScribeReviewDetailsScreen port exists yet"). One `testWidgets` covering
/// render, add-comment and thread navigation together rather than split
/// across files like the simulation-review tests: the "pumping
/// ReviewDetailsScreen wedges localizationControllerProvider for later
/// tests in the same file" issue documented in
/// `_review_details_test_fixtures.dart` only requires *this file* to have
/// no sibling scenarios, not that each assertion live in its own file.
void main() {
  testWidgets(
    'renders scribe note/comments, posts a comment via the scribe repository, and '
    'navigates a thread tap to ThreadDetailScreen with reviewType.scribe',
    (tester) async {
      final repository = MockScribeReviewsRepository();
      final review = ReviewItem(
        id: 'srev-1',
        createdAt: '2026-01-01T00:00:00Z',
        note: 'please check this call',
        createdBy: ReviewAuthor(id: 1, name: 'Dr. Patel', profileImage: ''),
        commentsCount: 1,
        summaryName: null,
      );
      when(() => repository.getScribeReview('srev-1')).thenAnswer((_) async => review);

      var callCount = 0;
      when(() => repository.getGeneralComments('srev-1')).thenAnswer((_) async {
        callCount++;
        if (callCount == 1) {
          return [ReviewComment(id: 'c-1', content: 'Great call', createdAt: null, authorName: 'Sam')];
        }
        return [
          ReviewComment(id: 'c-1', content: 'Great call', createdAt: null, authorName: 'Sam'),
          ReviewComment(id: 'c-new', content: 'nice work', createdAt: null, authorName: 'Me'),
        ];
      });
      when(() => repository.addGeneralComment(reviewId: 'srev-1', content: 'nice work'))
          .thenAnswer((_) async {});

      when(() => repository.getThreads('srev-1')).thenAnswer(
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
        const ReviewDetailsScreen(reviewId: 'srev-1', reviewType: ReviewType.scribe),
        overrides: [scribeReviewsRepositoryProvider.overrideWithValue(repository)],
      );

      expect(find.text('Dr. Patel'), findsOneWidget);
      expect(find.text('please check this call'), findsOneWidget);
      expect(find.text('Great call'), findsOneWidget);

      await tester.enterText(find.byType(TextField), 'nice work');
      await tester.tap(find.byIcon(Icons.send));
      await tester.pumpAndSettle();

      verify(() => repository.addGeneralComment(reviewId: 'srev-1', content: 'nice work')).called(1);
      expect(find.text('nice work'), findsOneWidget);

      await tester.tap(find.text('Threads'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('anchor text'));
      await tester.pumpAndSettle();

      expect(find.byType(ThreadDetailScreen), findsOneWidget);
      final threadScreen = tester.widget<ThreadDetailScreen>(find.byType(ThreadDetailScreen));
      expect(threadScreen.reviewType, ReviewType.scribe);
    },
  );
}
