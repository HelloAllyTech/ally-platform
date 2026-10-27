import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/thread_detail_screen.dart';

import '../../support/pump_app.dart';
import '_thread_detail_test_fixtures.dart';

// See `_thread_detail_test_fixtures.dart` for why this is one test per file.
void main() {
  testWidgets('renders the anchor message (client) and the root comment', (tester) async {
    final reviewsRepository = MockReviewsRepository();
    final reactionsRepository = MockReactionsRepository();
    final thread = ReviewThread(
      id: 'th-1',
      comments: [buildComment(id: 'rc-1', content: 'root comment', authorName: 'Jordan')],
      commentCount: 1,
      createdBy: ReviewAuthor(id: 1, name: 'Jordan', profileImage: ''),
      message: ReviewThreadMessage(id: 'm-1', content: 'I feel anxious', senderId: -1),
    );

    await pumpApp(
      tester,
      ThreadDetailScreen(reviewId: 'rev-1', thread: thread, reviewOwnerId: 1),
      overrides: threadDetailOverrides(reviewsRepository, reactionsRepository),
    );

    expect(find.text('Client said'), findsOneWidget);
    expect(find.text('I feel anxious'), findsOneWidget);
    expect(find.text('Jordan'), findsOneWidget);
    expect(find.text('root comment'), findsOneWidget);
  });
}
