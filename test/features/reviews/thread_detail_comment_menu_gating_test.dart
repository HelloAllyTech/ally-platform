import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/thread_detail_screen.dart';

import '../../support/pump_app.dart';
import '_thread_detail_test_fixtures.dart';

// See `_thread_detail_test_fixtures.dart` for why this is one test per file.
void main() {
  testWidgets('a user who is neither the comment author nor the review owner sees no menu at all', (
    tester,
  ) async {
    final reviewsRepository = MockReviewsRepository();
    final reactionsRepository = MockReactionsRepository();
    final thread = ReviewThread(
      id: 'th-1',
      comments: [buildComment(id: 'rc-1', content: 'not mine', authorName: 'Them', authorId: 2)],
      commentCount: 1,
      createdBy: ReviewAuthor(id: 3, name: 'Also not me', profileImage: ''),
      message: null,
    );

    await pumpApp(
      tester,
      ThreadDetailScreen(reviewId: 'rev-1', thread: thread, reviewOwnerId: 3, isPrivate: false),
      overrides: threadDetailOverrides(reviewsRepository, reactionsRepository, currentUserId: 1),
    );

    expect(find.byKey(const Key('comment-actions-menu')), findsNothing);
  });
}
