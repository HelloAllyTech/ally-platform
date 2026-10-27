import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/thread_detail_screen.dart';

import '../../support/pump_app.dart';
import '_thread_detail_test_fixtures.dart';

// See `_thread_detail_test_fixtures.dart` for why this is one test per file.
void main() {
  testWidgets('a hidden comment offers neither Edit nor Delete to its own author', (tester) async {
    final reviewsRepository = MockReviewsRepository();
    final reactionsRepository = MockReactionsRepository();
    final thread = ReviewThread(
      id: 'th-1',
      comments: [
        buildComment(
          id: 'rc-1',
          content: 'hidden comment',
          authorName: 'Me',
          authorId: 1,
          hidden: true,
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

    expect(find.text('Edit'), findsNothing);
    expect(find.text('Delete'), findsNothing);
    expect(find.text('Unhide'), findsOneWidget);
  });
}
