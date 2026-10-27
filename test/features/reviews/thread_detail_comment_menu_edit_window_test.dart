import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/thread_detail_screen.dart';

import '../../support/pump_app.dart';
import '_thread_detail_test_fixtures.dart';

// See `_thread_detail_test_fixtures.dart` for why this is one test per file.
void main() {
  testWidgets("the comment's own author outside the edit time window keeps Delete but loses Edit", (
    tester,
  ) async {
    final reviewsRepository = MockReviewsRepository();
    final reactionsRepository = MockReactionsRepository();
    final thread = ReviewThread(
      id: 'th-1',
      comments: [
        buildComment(
          id: 'rc-1',
          content: 'posted a while ago',
          authorName: 'Me',
          authorId: 1,
          createdAt: DateTime.now().toUtc().subtract(const Duration(minutes: 30)).toIso8601String(),
        ),
      ],
      commentCount: 1,
      createdBy: ReviewAuthor(id: 9, name: 'Reviewer', profileImage: ''),
      message: null,
    );

    await pumpApp(
      tester,
      ThreadDetailScreen(reviewId: 'rev-1', thread: thread, reviewOwnerId: 9),
      overrides: threadDetailOverrides(reviewsRepository, reactionsRepository, currentUserId: 1),
    );

    await tester.tap(find.byKey(const Key('comment-actions-menu')));
    await tester.pumpAndSettle();

    expect(find.text('Edit'), findsNothing);
    expect(find.text('Delete'), findsOneWidget);
  });
}
