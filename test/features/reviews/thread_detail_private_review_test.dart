import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/widgets/app_chat_input.dart';
import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/thread_detail_screen.dart';

import '../../support/pump_app.dart';
import '_thread_detail_test_fixtures.dart';

// See `_thread_detail_test_fixtures.dart` for why this is one test per file.
//
// Every gate this test exercises (comment ownership, review ownership, the
// edit time window) is deliberately satisfied so that, were `isPrivate`
// ignored, the menu/composer/reactions would all show — proving `isPrivate`
// overrides them outright, exactly like ally-mobile (React Native)'s
// `ReplyBottomSheet.tsx` (`showActionsMenu={!isPrivate}`,
// `footerComponent={isPrivate ? undefined : ...}`).
void main() {
  testWidgets(
    'a private review hides the whole menu and the composer, and disables only the root reaction button',
    (tester) async {
      final reviewsRepository = MockReviewsRepository();
      final reactionsRepository = MockReactionsRepository();
      final thread = ReviewThread(
        id: 'th-1',
        comments: [
          buildComment(id: 'root-1', content: 'the anchor comment', authorName: 'Me', authorId: 1),
          buildComment(id: 'reply-1', content: 'a reply', authorName: 'Me', authorId: 1),
        ],
        commentCount: 2,
        createdBy: ReviewAuthor(id: 1, name: 'Me', profileImage: ''),
        message: null,
      );

      await pumpApp(
        tester,
        ThreadDetailScreen(reviewId: 'rev-1', thread: thread, reviewOwnerId: 1, isPrivate: true),
        overrides: threadDetailOverrides(reviewsRepository, reactionsRepository, currentUserId: 1),
      );

      // The whole actions menu is hidden on every comment, root and reply
      // alike — not just individual options within it.
      expect(find.byKey(const Key('comment-actions-menu')), findsNothing);

      // The reply composer disappears entirely.
      expect(find.byType(AppChatInput), findsNothing);

      // Only the root comment's reaction button loses its `PopupMenuButton`
      // (becomes a plain, non-interactive icon) — the reply's stays a real
      // `PopupMenuButton`, matching RN's confirmed asymmetry.
      expect(find.byType(PopupMenuButton<String>), findsOneWidget);
    },
  );
}
