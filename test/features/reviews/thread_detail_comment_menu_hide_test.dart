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
    'the review owner (not the comment author) sees only Hide/Unhide, never Edit/Delete',
    (tester) async {
      final reviewsRepository = MockReviewsRepository();
      final reactionsRepository = MockReactionsRepository();
      when(
        () => reviewsRepository.updateCommentVisibility(commentId: 'rc-1', hidden: true),
      ).thenAnswer((_) async {});
      final thread = ReviewThread(
        id: 'th-1',
        // Current user (id 1) owns the REVIEW but did not author this
        // comment (authored by 2) — only Hide should show.
        comments: [
          buildComment(id: 'rc-1', content: 'someone else said this', authorName: 'Them', authorId: 2),
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

      expect(find.text('Edit'), findsNothing);
      expect(find.text('Delete'), findsNothing);
      expect(find.text('Hide'), findsOneWidget);

      await tester.tap(find.text('Hide'));
      await tester.pumpAndSettle();

      verify(() => reviewsRepository.updateCommentVisibility(commentId: 'rc-1', hidden: true)).called(1);
      expect(find.text('Hidden'), findsOneWidget);

      // Toggling again now offers "Unhide" and flips the request's `hidden`.
      when(
        () => reviewsRepository.updateCommentVisibility(commentId: 'rc-1', hidden: false),
      ).thenAnswer((_) async {});
      await tester.tap(find.byKey(const Key('comment-actions-menu')));
      await tester.pumpAndSettle();
      expect(find.text('Unhide'), findsOneWidget);
      await tester.tap(find.text('Unhide'));
      await tester.pumpAndSettle();

      verify(() => reviewsRepository.updateCommentVisibility(commentId: 'rc-1', hidden: false)).called(1);
      expect(find.text('Hidden'), findsNothing);
    },
  );
}
