import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/widgets/review_type_chip.dart';
import 'package:ally_mobile_flutter/features/reactions/data/reactions_repository.dart';
import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/data/scribe_reviews_repository.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/thread_detail_screen.dart';

import '../../support/pump_app.dart';

class MockScribeReviewsRepository extends Mock implements ScribeReviewsRepository {}

class MockScribeReactionsRepository extends Mock implements ScribeReactionsRepository {}

/// `ThreadDetailScreen(reviewType: ReviewType.scribe)` — replies and
/// comment reactions route through the scribe repositories instead of the
/// simulation ones. One `testWidgets` per file, same convention as
/// `_thread_detail_test_fixtures.dart` documents (pumping this screen
/// wedges `localizationControllerProvider` for later tests in the same
/// isolate).
void main() {
  testWidgets(
    'submitting a reply and picking a reaction both call the scribe repositories',
    (tester) async {
      final scribeReviews = MockScribeReviewsRepository();
      final scribeReactions = MockScribeReactionsRepository();
      final root = ThreadComment(
        id: 'rc-1',
        content: 'root comment',
        createdAt: null,
        authorName: 'Jordan',
        reactions: const {},
        myReaction: null,
      );
      final thread = ReviewThread(
        id: 'th-1',
        comments: [root],
        commentCount: 1,
        createdBy: ReviewAuthor(id: 1, name: 'Jordan', profileImage: ''),
        message: ReviewThreadMessage(id: 'm-1', content: 'anchor', senderId: -1),
      );

      when(() => scribeReviews.addThreadReply(
            reviewId: 'srev-1',
            threadId: 'th-1',
            content: 'me too',
          )).thenAnswer((_) async {});
      when(() => scribeReviews.getCommentReplies('rc-1', limit: 50)).thenAnswer(
        (_) async => (
          replies: [
            ThreadComment(
              id: 'rc-2',
              content: 'me too',
              createdAt: null,
              authorName: 'Me',
              reactions: const {},
              myReaction: null,
            ),
          ],
          count: 2,
        ),
      );
      when(() => scribeReactions.addReactionToComment(
            commentId: 'rc-1',
            reaction: '1f44d',
            action: ReactionAction.add,
          )).thenAnswer((_) async {});

      await pumpApp(
        tester,
        ThreadDetailScreen(reviewId: 'srev-1', thread: thread, reviewType: ReviewType.scribe, reviewOwnerId: 1),
        overrides: [
          scribeReviewsRepositoryProvider.overrideWithValue(scribeReviews),
          scribeReactionsRepositoryProvider.overrideWithValue(scribeReactions),
        ],
      );

      await tester.enterText(find.byType(TextField), 'me too');
      await tester.tap(find.byIcon(Icons.send));
      await tester.pumpAndSettle();

      verify(() => scribeReviews.addThreadReply(
            reviewId: 'srev-1',
            threadId: 'th-1',
            content: 'me too',
          )).called(1);
      expect(find.text('Me'), findsOneWidget);

      await tester.tap(find.byType(PopupMenuButton<String>).first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('👍').last);
      await tester.pumpAndSettle();

      verify(() => scribeReactions.addReactionToComment(
            commentId: 'rc-1',
            reaction: '1f44d',
            action: ReactionAction.add,
          )).called(1);
    },
  );
}
