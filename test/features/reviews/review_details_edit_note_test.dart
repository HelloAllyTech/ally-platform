import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';
import 'package:ally_mobile_flutter/features/account/data/account_repository.dart';
import 'package:ally_mobile_flutter/features/account/data/user_profile.dart';
import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/data/reviews_repository.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/review_details_screen.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/share_for_review_screen.dart';

import '../../support/pump_router_app.dart';
import '_review_details_test_fixtures.dart';

// See `_review_details_test_fixtures.dart` for why this is one test per
// file rather than grouped with the screen's other scenarios.
void main() {
  ReviewItem recentReview() => ReviewItem(
        id: 'rev-1',
        // Well within the 10-minute edit window `isMinutesPassed` checks.
        createdAt: DateTime.now().toUtc().toIso8601String(),
        note: 'please look at this session',
        createdBy: ReviewAuthor(id: 1, name: 'Dr. Patel', profileImage: ''),
        commentsCount: 2,
        summaryName: null,
      );

  testWidgets(
    'the owner can edit a fresh note, landing on ShareForReviewScreen pre-filled in edit mode',
    (tester) async {
      final repository = MockReviewsRepository();
      when(() => repository.getReview('rev-1')).thenAnswer((_) async => recentReview());
      when(() => repository.getGeneralComments('rev-1')).thenAnswer((_) async => []);
      when(() => repository.getThreads('rev-1'))
          .thenAnswer((_) async => (threads: <ReviewThread>[], count: 0));

      await pumpRouterApp(
        tester,
        initialLocation: '/reviews/rev-1',
        routes: [
          GoRoute(
            path: '/reviews/rev-1',
            builder: (context, state) => const ReviewDetailsScreen(reviewId: 'rev-1'),
          ),
          GoRoute(
            path: '/share-for-review/:scenarioSessionId',
            builder: (context, state) {
              final editArgs = state.extra as ({String reviewId, String note})?;
              return ShareForReviewScreen(
                scenarioSessionId: state.pathParameters['scenarioSessionId']!,
                reviewId: editArgs?.reviewId,
                isEditNote: editArgs != null,
                initialNote: editArgs?.note,
              );
            },
          ),
        ],
        overrides: [
          reviewsRepositoryProvider.overrideWithValue(repository),
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

      await tester.tap(find.byIcon(Icons.edit));
      await tester.pumpAndSettle();

      expect(find.text('Edit note'), findsOneWidget, reason: 'edit-mode screen title');
      expect(find.text('please look at this session'), findsOneWidget, reason: 'note prefilled');
    },
  );

  testWidgets('no edit affordance once the edit window has passed', (tester) async {
    final repository = MockReviewsRepository();
    // `buildReview()`'s createdAt is 2026-01-01 — long past the 10-minute window.
    when(() => repository.getReview('rev-1')).thenAnswer((_) async => buildReview());
    when(() => repository.getGeneralComments('rev-1')).thenAnswer((_) async => []);
    when(() => repository.getThreads('rev-1'))
        .thenAnswer((_) async => (threads: <ReviewThread>[], count: 0));

    await pumpRouterApp(
      tester,
      initialLocation: '/reviews/rev-1',
      routes: [
        GoRoute(
          path: '/reviews/rev-1',
          builder: (context, state) => const ReviewDetailsScreen(reviewId: 'rev-1'),
        ),
      ],
      overrides: [
        reviewsRepositoryProvider.overrideWithValue(repository),
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

    expect(find.byIcon(Icons.edit), findsNothing);
  });
}
