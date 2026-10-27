import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/thread_detail_screen.dart';

import '../../support/pump_app.dart';
import '_thread_detail_test_fixtures.dart';

// See `_thread_detail_test_fixtures.dart` for why this is one test per file.
void main() {
  testWidgets('auto-loads additional replies on init and dedupes against already-shown ids',
      (tester) async {
    final reviewsRepository = MockReviewsRepository();
    final reactionsRepository = MockReactionsRepository();
    final root = buildComment(id: 'rc-1', content: 'root comment', authorName: 'Jordan');
    final thread = ReviewThread(
      id: 'th-1',
      comments: [root],
      commentCount: 3,
      createdBy: ReviewAuthor(id: 1, name: 'Jordan', profileImage: ''),
      message: ReviewThreadMessage(id: 'm-1', content: 'anchor', senderId: -1),
    );

    when(() => reviewsRepository.getCommentReplies('rc-1', limit: 50)).thenAnswer(
      (_) async => (
        replies: [
          root, // duplicate of the already-shown root comment — must be deduped
          buildComment(id: 'rc-2', content: 'reply two', authorName: 'Sam'),
          buildComment(id: 'rc-3', content: 'reply three', authorName: 'Alex'),
        ],
        count: 3,
      ),
    );

    await pumpApp(
      tester,
      ThreadDetailScreen(reviewId: 'rev-1', thread: thread, reviewOwnerId: 1),
      overrides: threadDetailOverrides(reviewsRepository, reactionsRepository),
    );

    verify(() => reviewsRepository.getCommentReplies('rc-1', limit: 50)).called(1);
    expect(find.text('root comment'), findsOneWidget);
    expect(find.text('reply two'), findsOneWidget);
    expect(find.text('reply three'), findsOneWidget);
    // Fully loaded (root + 2 deduped replies === commentCount) — no retry button.
    expect(find.textContaining('more replies'), findsNothing);
    expect(find.textContaining('more reply'), findsNothing);
  });
}
