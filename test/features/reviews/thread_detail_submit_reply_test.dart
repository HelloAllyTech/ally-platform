import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/thread_detail_screen.dart';

import '../../support/pump_app.dart';
import '_thread_detail_test_fixtures.dart';

// See `_thread_detail_test_fixtures.dart` for why this is one test per file.
void main() {
  testWidgets('submitting a reply calls addThreadReply, clears the input and reloads',
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

    when(() => reviewsRepository.addThreadReply(
          reviewId: 'rev-1',
          threadId: 'th-1',
          content: 'me too',
        )).thenAnswer((_) async {});
    when(() => reviewsRepository.getCommentReplies('rc-1', limit: 50)).thenAnswer(
      (_) async =>
          (replies: [buildComment(id: 'rc-2', content: 'me too', authorName: 'Me')], count: 2),
    );

    await pumpApp(
      tester,
      ThreadDetailScreen(reviewId: 'rev-1', thread: thread, reviewOwnerId: 1, isPrivate: false),
      overrides: threadDetailOverrides(reviewsRepository, reactionsRepository),
    );

    await tester.enterText(find.byType(TextField), 'me too');
    await tester.tap(find.byIcon(Icons.send));
    await tester.pumpAndSettle();

    verify(() => reviewsRepository.addThreadReply(
          reviewId: 'rev-1',
          threadId: 'th-1',
          content: 'me too',
        )).called(1);
    verify(() => reviewsRepository.getCommentReplies('rc-1', limit: 50)).called(1);
    expect(find.text('Me'), findsOneWidget);

    final textField = tester.widget<TextField>(find.byType(TextField));
    expect(textField.controller!.text, isEmpty);
  });
}
