import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';
import 'package:ally_mobile_flutter/core/widgets/review_type_chip.dart';
import 'package:ally_mobile_flutter/features/account/data/account_repository.dart';
import 'package:ally_mobile_flutter/features/account/data/user_profile.dart';
import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/data/scribe_reviews_repository.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/review_details_screen.dart';

import '../../support/pump_app.dart';

class MockScribeReviewsRepository extends Mock implements ScribeReviewsRepository {}

// Kept in its own file, same discipline as `_review_details_test_fixtures.dart`
// documents: pumping `ReviewDetailsScreen` wedges `localizationControllerProvider`
// for any later widget test in the same file/isolate.
void main() {
  testWidgets(
    'toggling privacy on a SCRIBE review PATCHes /scribe-session-reviews, not the '
    'simulation-review resource — regression test for a real bug found while porting '
    "CallSummaryScreen's header (it used to always hit the simulation endpoint)",
    (tester) async {
      final repository = MockScribeReviewsRepository();
      final review = ReviewItem(
        id: 'srev-1',
        createdAt: '2026-01-01T00:00:00Z',
        note: 'please check this call',
        createdBy: ReviewAuthor(id: 1, name: 'Dr. Patel', profileImage: ''),
        commentsCount: 0,
        summaryName: null,
      );
      when(() => repository.getScribeReview('srev-1')).thenAnswer((_) async => review);
      when(() => repository.getGeneralComments('srev-1')).thenAnswer((_) async => []);
      when(() => repository.getThreads('srev-1'))
          .thenAnswer((_) async => (threads: <ReviewThread>[], count: 0));
      when(() => repository.updateReviewStatus(reviewId: 'srev-1', status: 'HIDDEN'))
          .thenAnswer((_) async {});

      await pumpApp(
        tester,
        const ReviewDetailsScreen(reviewId: 'srev-1', reviewType: ReviewType.scribe),
        overrides: [
          scribeReviewsRepositoryProvider.overrideWithValue(repository),
          // `review.createdBy.id` is 1 — matching it here makes this user
          // the review's owner, which is what shows the toggle at all.
          currentUserProvider.overrideWith(
            (ref) async => UserProfile(
              id: 1,
              email: 'me@example.com',
              name: 'Me',
              phone: '',
              profileImageUrl: null,
              profileCompleted: true,
            ),
          ),
          userPermissionsProvider.overrideWith((ref) async => [UserPermissions.editScribeReview]),
        ],
      );

      final toggle = find.byType(Switch);
      expect(toggle, findsOneWidget);

      await tester.tap(toggle);
      await tester.pumpAndSettle();

      verify(() => repository.updateReviewStatus(reviewId: 'srev-1', status: 'HIDDEN')).called(1);
      expect(find.text('Privacy setting updated'), findsOneWidget);
    },
  );
}
