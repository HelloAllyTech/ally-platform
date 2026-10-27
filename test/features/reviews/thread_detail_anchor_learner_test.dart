import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/thread_detail_screen.dart';

import '../../support/pump_app.dart';
import '_thread_detail_test_fixtures.dart';

// See `_thread_detail_test_fixtures.dart` for why this is one test per file.
void main() {
  testWidgets(
      'renders "Learner said" when the anchor message is not from the client (senderId != -1)',
      (tester) async {
    final reviewsRepository = MockReviewsRepository();
    final reactionsRepository = MockReactionsRepository();
    final thread = ReviewThread(
      id: 'th-1',
      comments: [buildComment(id: 'rc-1', content: 'root comment', authorName: 'Jordan')],
      commentCount: 1,
      createdBy: ReviewAuthor(id: 1, name: 'Jordan', profileImage: ''),
      message: ReviewThreadMessage(id: 'm-1', content: 'thanks for sharing', senderId: 42),
    );

    await pumpApp(
      tester,
      ThreadDetailScreen(reviewId: 'rev-1', thread: thread, reviewOwnerId: 1, isPrivate: false),
      overrides: threadDetailOverrides(reviewsRepository, reactionsRepository),
    );

    expect(find.text('Learner said'), findsOneWidget);
  });
}
