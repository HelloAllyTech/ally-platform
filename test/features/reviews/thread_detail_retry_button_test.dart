import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/thread_detail_screen.dart';

import '../../support/pump_app.dart';
import '_thread_detail_test_fixtures.dart';

// See `_thread_detail_test_fixtures.dart` for why this is one test per file.
void main() {
  testWidgets('shows a retry button when the initial replies load fails, and retrying succeeds',
      (tester) async {
    final reviewsRepository = MockReviewsRepository();
    final reactionsRepository = MockReactionsRepository();
    final root = buildComment(id: 'rc-1', content: 'root comment', authorName: 'Jordan');
    final thread = ReviewThread(
      id: 'th-1',
      comments: [root],
      commentCount: 2,
      createdBy: ReviewAuthor(id: 1, name: 'Jordan', profileImage: ''),
      message: ReviewThreadMessage(id: 'm-1', content: 'anchor', senderId: -1),
    );

    var attempt = 0;
    when(() => reviewsRepository.getCommentReplies('rc-1', limit: 50)).thenAnswer((_) async {
      attempt++;
      if (attempt == 1) throw Exception('network blip');
      return (
        replies: [buildComment(id: 'rc-2', content: 'reply two', authorName: 'Sam')],
        count: 2,
      );
    });

    await pumpApp(
      tester,
      ThreadDetailScreen(reviewId: 'rev-1', thread: thread),
      overrides: threadDetailOverrides(reviewsRepository, reactionsRepository),
    );

    expect(find.text('Load 1 more reply'), findsOneWidget);
    expect(find.text('reply two'), findsNothing);

    await tester.tap(find.text('Load 1 more reply'));
    await tester.pumpAndSettle();

    expect(find.text('reply two'), findsOneWidget);
    verify(() => reviewsRepository.getCommentReplies('rc-1', limit: 50)).called(2);
  });
}
