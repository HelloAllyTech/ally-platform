import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/thread_detail_screen.dart';

import '../../support/pump_app.dart';
import '_thread_detail_test_fixtures.dart';

// See `_thread_detail_test_fixtures.dart` for why this is one test per file.
void main() {
  testWidgets('deleting a comment confirms first, then removes it from the list', (tester) async {
    final reviewsRepository = MockReviewsRepository();
    final reactionsRepository = MockReactionsRepository();
    when(() => reviewsRepository.deleteComment('rc-1')).thenAnswer((_) async {});
    final thread = ReviewThread(
      id: 'th-1',
      // Current user (id 1) owns this comment but NOT the review (owner is
      // 99) — only Edit/Delete should show, never Hide.
      comments: [
        buildComment(
          id: 'rc-1',
          content: 'delete me',
          authorName: 'Me',
          authorId: 1,
          createdAt: DateTime.now().toUtc().toIso8601String(),
        ),
      ],
      commentCount: 1,
      createdBy: ReviewAuthor(id: 99, name: 'Someone else', profileImage: ''),
      message: null,
    );

    await pumpApp(
      tester,
      ThreadDetailScreen(reviewId: 'rev-1', thread: thread, reviewOwnerId: 99),
      overrides: threadDetailOverrides(reviewsRepository, reactionsRepository, currentUserId: 1),
    );

    await tester.tap(find.byKey(const Key('comment-actions-menu')));
    await tester.pumpAndSettle();

    expect(find.text('Edit'), findsOneWidget);
    expect(find.text('Delete'), findsOneWidget);
    expect(find.text('Hide'), findsNothing);

    await tester.tap(find.text('Delete'));
    await tester.pumpAndSettle();

    // The confirmation modal, not the deletion itself, happens first. The
    // menu is already dismissed, so the sole remaining "Delete" text is the
    // modal's confirm button. The modal's title renders via `Text.rich`
    // (ConfirmationModal always appends a trailing space, even with no
    // subtitle), so `findRichText`/`textContaining` are both needed here.
    verifyNever(() => reviewsRepository.deleteComment('rc-1'));
    expect(find.textContaining('Delete Comment', findRichText: true), findsOneWidget);
    expect(find.text('Delete'), findsOneWidget);

    await tester.tap(find.text('Delete'));
    await tester.pumpAndSettle();

    verify(() => reviewsRepository.deleteComment('rc-1')).called(1);
    expect(find.text('delete me'), findsNothing);
  });
}
