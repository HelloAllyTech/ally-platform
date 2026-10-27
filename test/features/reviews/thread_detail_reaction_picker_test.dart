import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/reactions/data/reactions_repository.dart';
import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/thread_detail_screen.dart';

import '../../support/pump_app.dart';
import '_thread_detail_test_fixtures.dart';

// See `_thread_detail_test_fixtures.dart` for why this is one test per file.
void main() {
  testWidgets('picking a reaction from the popup calls addReactionToComment and reloads',
      (tester) async {
    final reviewsRepository = MockReviewsRepository();
    final reactionsRepository = MockReactionsRepository();
    final root = buildComment(id: 'rc-1', content: 'root comment', authorName: 'Jordan');
    final thread = ReviewThread(
      id: 'th-1',
      comments: [root],
      commentCount: 1,
      createdBy: ReviewAuthor(id: 1, name: 'Jordan', profileImage: ''),
      message: ReviewThreadMessage(id: 'm-1', content: 'anchor', senderId: -1),
    );

    when(() => reactionsRepository.addReactionToComment(
          commentId: 'rc-1',
          reaction: '1f44d',
          action: ReactionAction.add,
        )).thenAnswer((_) async {});
    // `_loadReplies()` only ever *appends* ids it hasn't already rendered
    // (see its dedup logic) — reacting to the already-shown root comment
    // therefore can't make its own reaction badge reappear with updated
    // counts purely from this reload; what's verifiable here is that the
    // reaction call happens and that a reload is triggered afterwards.
    when(() => reviewsRepository.getCommentReplies('rc-1', limit: 50))
        .thenAnswer((_) async => (replies: const <ThreadComment>[], count: 1));

    await pumpApp(
      tester,
      ThreadDetailScreen(reviewId: 'rev-1', thread: thread, reviewOwnerId: 1, isPrivate: false),
      overrides: threadDetailOverrides(reviewsRepository, reactionsRepository),
    );

    await tester.tap(find.byType(PopupMenuButton<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('👍').last);
    await tester.pumpAndSettle();

    verify(() => reactionsRepository.addReactionToComment(
          commentId: 'rc-1',
          reaction: '1f44d',
          action: ReactionAction.add,
        )).called(1);
    // Called once more after the reaction (beyond the implicit initial
    // auto-load, which this fixture's `commentCount: 1 == comments.length`
    // skips) — confirms `_react` triggers a reload.
    verify(() => reviewsRepository.getCommentReplies('rc-1', limit: 50)).called(1);
  });
}
