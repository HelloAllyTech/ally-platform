import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';
import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/data/reviews_repository.dart';
import 'package:ally_mobile_flutter/core/widgets/review_type_chip.dart';
import 'package:ally_mobile_flutter/features/reviews/data/scribe_reviews_repository.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/review_screen.dart';
import 'package:go_router/go_router.dart';

import '../../support/fake_translations.dart';

class MockReviewsRepository extends Mock implements ReviewsRepository {}

class MockScribeReviewsRepository extends Mock implements ScribeReviewsRepository {}

ReviewItem _review({required String id, required String name}) => ReviewItem(
      id: id,
      createdAt: '2026-01-01T00:00:00Z',
      note: 'note for $name',
      createdBy: ReviewAuthor(id: 1, name: name, profileImage: ''),
      commentsCount: 0,
      summaryName: null,
    );

Future<void> _pump(
  WidgetTester tester, {
  required MockReviewsRepository reviewsRepository,
  required MockScribeReviewsRepository scribeRepository,
  required List<String> permissions,
}) async {
  SharedPreferences.setMockInitialValues({});
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        fixedTranslationsOverride(),
        reviewsRepositoryProvider.overrideWithValue(reviewsRepository),
        scribeReviewsRepositoryProvider.overrideWithValue(scribeRepository),
        userPermissionsProvider.overrideWith((ref) async => permissions),
      ],
      child: const MaterialApp(home: ReviewScreen()),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  // One testWidgets per permission scenario — see call_log_screen_test.dart's
  // doc comment for why (sequential pumps with this same screen/provider
  // shape can reuse a previous scenario's resolved userPermissionsProvider
  // value instead of picking up the new override).
  testWidgets('both permissions: tab switcher appears, scribe first, switches lists', (
    tester,
  ) async {
    final reviewsRepository = MockReviewsRepository();
    final scribeRepository = MockScribeReviewsRepository();
    when(() => reviewsRepository.getReviews()).thenAnswer((_) async => [_review(id: 's1', name: 'Sam')]);
    when(() => scribeRepository.getScribeReviews())
        .thenAnswer((_) async => [_review(id: 'r1', name: 'Robin')]);

    await _pump(
      tester,
      reviewsRepository: reviewsRepository,
      scribeRepository: scribeRepository,
      permissions: [
        UserPermissions.viewSimulationReviews,
        UserPermissions.viewScribeReviews,
        UserPermissions.viewSimulationReview,
      ],
    );

    expect(find.text('Scribe'), findsWidgets);
    expect(find.text('Simulation'), findsWidgets);
    expect(find.text('Robin'), findsOneWidget, reason: 'scribe is the default/first tab');
    expect(find.text('Sam'), findsNothing);

    await tester.tap(find.text('Simulation').first);
    await tester.pumpAndSettle();

    expect(find.text('Sam'), findsOneWidget);
    expect(find.text('Robin'), findsNothing);
  });

  testWidgets('only VIEW_SCRIBE_REVIEWS: no tab switcher, scribe list renders directly', (
    tester,
  ) async {
    final reviewsRepository = MockReviewsRepository();
    final scribeRepository = MockScribeReviewsRepository();
    when(() => scribeRepository.getScribeReviews())
        .thenAnswer((_) async => [_review(id: 'r1', name: 'Robin')]);

    await _pump(
      tester,
      reviewsRepository: reviewsRepository,
      scribeRepository: scribeRepository,
      permissions: [UserPermissions.viewScribeReviews],
    );

    // Exactly one "Scribe" text (the per-row ReviewTypeChip) and no
    // "Simulation" text at all — proves no AppTabView switcher rendered
    // (which would otherwise add a second "Scribe" tab label).
    expect(find.text('Scribe'), findsOneWidget);
    expect(find.text('Simulation'), findsNothing);
    expect(find.text('Robin'), findsOneWidget);

    // VIEW_SCRIBE_REVIEWS (plural, list visibility) without VIEW_SCRIBE_REVIEW
    // (singular, detail visibility) leaves the row disabled — same gating
    // CallLogScreen/simulation reviews already use.
    await tester.tap(find.text('Robin'));
    await tester.pumpAndSettle();
    verifyNever(() => scribeRepository.markAsRead(any()));
  });

  testWidgets('with VIEW_SCRIBE_REVIEW too: tapping a scribe review marks it read and navigates', (
    tester,
  ) async {
    final reviewsRepository = MockReviewsRepository();
    final scribeRepository = MockScribeReviewsRepository();
    when(() => scribeRepository.getScribeReviews())
        .thenAnswer((_) async => [_review(id: 'r1', name: 'Robin')]);
    when(() => scribeRepository.markAsRead('r1')).thenAnswer((_) async {});

    final router = GoRouter(
      initialLocation: '/',
      routes: [
        GoRoute(path: '/', builder: (context, state) => const ReviewScreen()),
        GoRoute(
          path: '/reviews/:id',
          builder: (context, state) =>
              Text('review-detail-${state.pathParameters['id']}-${state.extra}'),
        ),
      ],
    );
    addTearDown(router.dispose);

    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          fixedTranslationsOverride(),
          reviewsRepositoryProvider.overrideWithValue(reviewsRepository),
          scribeReviewsRepositoryProvider.overrideWithValue(scribeRepository),
          userPermissionsProvider.overrideWith(
            (ref) async => [
              UserPermissions.viewScribeReviews,
              UserPermissions.viewScribeReview,
            ],
          ),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Robin'));
    await tester.pumpAndSettle();

    verify(() => scribeRepository.markAsRead('r1')).called(1);
    expect(find.text('review-detail-r1-${ReviewType.scribe}'), findsOneWidget);
  });

  testWidgets('neither permission: empty state, no crash', (tester) async {
    final reviewsRepository = MockReviewsRepository();
    final scribeRepository = MockScribeReviewsRepository();

    await _pump(
      tester,
      reviewsRepository: reviewsRepository,
      scribeRepository: scribeRepository,
      permissions: const [],
    );

    expect(find.text('No shared sessions yet'), findsOneWidget);
  });
}
