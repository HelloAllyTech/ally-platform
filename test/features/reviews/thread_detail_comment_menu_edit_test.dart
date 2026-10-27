import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/thread_detail_screen.dart';

import '../../support/pump_app.dart';
import '_thread_detail_test_fixtures.dart';

// See `_thread_detail_test_fixtures.dart` for why this is one test per file.
void main() {
  testWidgets(
    "the comment's own author can edit it within the time window, and the review owner's own Hide item shows too",
    (tester) async {
      final reviewsRepository = MockReviewsRepository();
      final reactionsRepository = MockReactionsRepository();
      when(
        () => reviewsRepository.updateComment(commentId: 'rc-1', content: 'edited text'),
      ).thenAnswer((_) async {});
      final thread = ReviewThread(
        id: 'th-1',
        comments: [
          // Current user (id 1) is BOTH the comment's author AND the
          // review's owner — RN shows Edit/Delete AND Hide together in
          // this case (`ReviewComment.tsx`'s `getMenuOptions` evaluates
          // both independently).
          buildComment(
            id: 'rc-1',
            content: 'original text',
            authorName: 'Me',
            authorId: 1,
            createdAt: DateTime.now().toUtc().toIso8601String(),
          ),
        ],
        commentCount: 1,
        createdBy: ReviewAuthor(id: 1, name: 'Me', profileImage: ''),
        message: null,
      );

      await pumpApp(
        tester,
        ThreadDetailScreen(reviewId: 'rev-1', thread: thread, reviewOwnerId: 1, isPrivate: false),
        overrides: threadDetailOverrides(reviewsRepository, reactionsRepository, currentUserId: 1),
      );

      await tester.tap(find.byKey(const Key('comment-actions-menu')));
      await tester.pumpAndSettle();

      expect(find.text('Edit'), findsOneWidget);
      expect(find.text('Delete'), findsOneWidget);
      expect(find.text('Hide'), findsOneWidget);

      await tester.tap(find.text('Edit'));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('comment-edit-field')), findsOneWidget);
      await tester.enterText(find.byKey(const Key('comment-edit-field')), 'edited text');
      await tester.tap(find.byKey(const Key('comment-edit-save')));
      await tester.pumpAndSettle();

      expect(find.text('edited text'), findsOneWidget);
      expect(find.text('original text'), findsNothing);
      verify(() => reviewsRepository.updateComment(commentId: 'rc-1', content: 'edited text')).called(1);
    },
  );
}
