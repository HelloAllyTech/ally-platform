import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';
import 'package:ally_mobile_flutter/features/account/data/account_repository.dart';
import 'package:ally_mobile_flutter/features/account/data/user_profile.dart';
import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/data/reviews_repository.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/review_details_screen.dart';

import '../../support/pump_app.dart';
import '_review_details_test_fixtures.dart';

// See `_review_details_test_fixtures.dart` for why this is one test per
// file rather than grouped with the screen's other scenarios.
void main() {
  testWidgets(
    'the review owner with edit permission can toggle privacy, which PATCHes the status',
    (tester) async {
      final repository = MockReviewsRepository();
      when(() => repository.getReview('rev-1')).thenAnswer((_) async => buildReview());
      when(() => repository.getGeneralComments('rev-1')).thenAnswer((_) async => []);
      when(() => repository.getThreads('rev-1'))
          .thenAnswer((_) async => (threads: <ReviewThread>[], count: 0));
      when(() => repository.updateReviewStatus(reviewId: 'rev-1', status: 'HIDDEN'))
          .thenAnswer((_) async {});

      await pumpApp(
        tester,
        const ReviewDetailsScreen(reviewId: 'rev-1'),
        overrides: [
          reviewsRepositoryProvider.overrideWithValue(repository),
          // `buildReview()`'s `createdBy.id` is 1 — matching it here is what
          // makes this user the review's owner.
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
          userPermissionsProvider.overrideWith(
            (ref) async => [UserPermissions.editSimulationReview],
          ),
        ],
      );

      final toggle = find.byType(Switch);
      expect(toggle, findsOneWidget);
      expect(tester.widget<Switch>(toggle).value, isTrue, reason: 'visible by default (not HIDDEN)');

      await tester.tap(toggle);
      await tester.pumpAndSettle();

      verify(() => repository.updateReviewStatus(reviewId: 'rev-1', status: 'HIDDEN')).called(1);
      expect(find.text('Privacy setting updated'), findsOneWidget);
    },
  );

  testWidgets('no privacy toggle is shown to someone other than the review owner', (tester) async {
    final repository = MockReviewsRepository();
    when(() => repository.getReview('rev-1')).thenAnswer((_) async => buildReview());
    when(() => repository.getGeneralComments('rev-1')).thenAnswer((_) async => []);
    when(() => repository.getThreads('rev-1'))
        .thenAnswer((_) async => (threads: <ReviewThread>[], count: 0));

    await pumpApp(
      tester,
      const ReviewDetailsScreen(reviewId: 'rev-1'),
      overrides: [
        reviewsRepositoryProvider.overrideWithValue(repository),
        // userId 2 != buildReview()'s createdBy.id of 1 — not the owner.
        currentUserProvider.overrideWith(
          (ref) async => UserProfile(
            id: 2,
            email: 'other@example.com',
            name: 'Someone Else',
            phone: '',
            profileImageUrl: null,
            profileCompleted: true,
          ),
        ),
        userPermissionsProvider.overrideWith(
          (ref) async => [UserPermissions.editSimulationReview],
        ),
      ],
    );

    expect(find.byType(Switch), findsNothing);
  });
}
