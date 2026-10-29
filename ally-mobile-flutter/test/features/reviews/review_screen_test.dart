import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';
import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/data/reviews_repository.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/review_screen.dart';

import '../../support/fake_translations.dart';

/// Grants only the simulation-review permissions — matches these tests'
/// intent (single-list behavior, no tab switcher) without also needing a
/// ScribeReviewsRepository mock in every one of them.
Override _simulationReviewerPermissions() => userPermissionsProvider.overrideWith(
      (ref) async => [
        UserPermissions.viewSimulationReviews,
        UserPermissions.viewSimulationReview,
      ],
    );

class MockReviewsRepository extends Mock implements ReviewsRepository {}

void main() {
  late MockReviewsRepository repository;

  ReviewItem review({String id = 'rev-1', String note = 'a note', int commentsCount = 0}) =>
      ReviewItem(
        id: id,
        createdAt: '2026-01-01T00:00:00Z',
        note: note,
        createdBy: ReviewAuthor(id: 1, name: 'Alex', profileImage: ''),
        commentsCount: commentsCount,
        summaryName: null,
      );

  setUp(() {
    repository = MockReviewsRepository();
  });

  // NOTE: the loading-state and error-state tests live in their own files
  // (`review_screen_loading_test.dart`, `review_screen_error_test.dart`) —
  // see those files' doc comments for why. These three use
  // `fixedTranslationsOverride()` rather than `pumpApp`'s real async
  // translation load — ReviewScreen now also watches
  // `userPermissionsProvider`, and a second real async provider racing
  // `localizationControllerProvider`'s own was found (empirically, via a
  // debug dump showing raw i18n keys on screen) to retrigger the same
  // translation-stall class of bug `fake_translations.dart` documents.
  Future<void> pumpReview(
    WidgetTester tester,
    Widget child, {
    List<Override> overrides = const [],
  }) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(
      ProviderScope(
        overrides: [fixedTranslationsOverride(), ...overrides],
        child: MaterialApp(home: child),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('shows an empty state when there are no reviews', (tester) async {
    when(() => repository.getReviews(readFilter: any(named: 'readFilter'), sortBy: any(named: 'sortBy'), limit: any(named: 'limit'), offset: any(named: 'offset'))).thenAnswer((_) async => (items: <ReviewItem>[], count: 0));

    await pumpReview(
      tester,
      const ReviewScreen(),
      overrides: [reviewsRepositoryProvider.overrideWithValue(repository), _simulationReviewerPermissions()],
    );

    expect(find.text('No shared sessions yet'), findsOneWidget);
  });

  testWidgets('renders review rows with note, summary name and comment count', (tester) async {
    when(() => repository.getReviews(readFilter: any(named: 'readFilter'), sortBy: any(named: 'sortBy'), limit: any(named: 'limit'), offset: any(named: 'offset'))).thenAnswer((_) async => (items: [review(id: 'rev-1', note: 'please check this', commentsCount: 4)], count: 0));

    await pumpReview(
      tester,
      const ReviewScreen(),
      overrides: [reviewsRepositoryProvider.overrideWithValue(repository), _simulationReviewerPermissions()],
    );

    expect(find.text('Alex'), findsOneWidget);
    expect(find.text('please check this'), findsOneWidget);
    expect(find.text('4 Comments'), findsOneWidget);
  });

  testWidgets('tapping Review Conversation navigates to the detail route without marking it read', (tester) async {
    when(() => repository.getReviews(readFilter: any(named: 'readFilter'), sortBy: any(named: 'sortBy'), limit: any(named: 'limit'), offset: any(named: 'offset'))).thenAnswer((_) async => (items: [review(id: 'rev-42')], count: 0));
    when(() => repository.markAsRead('rev-42')).thenAnswer((_) async {});

    final router = GoRouter(
      initialLocation: '/',
      routes: [
        GoRoute(path: '/', builder: (context, state) => const ReviewScreen()),
        GoRoute(
          path: '/reviews/:id',
          builder: (context, state) =>
              Text('review-detail-${state.pathParameters['id']}'),
        ),
      ],
    );
    addTearDown(router.dispose);

    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          fixedTranslationsOverride(),
          reviewsRepositoryProvider.overrideWithValue(repository),
          _simulationReviewerPermissions(),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();

    // Tapping the user's name/avatar does nothing on the real card — only
    // the "Review Conversation" link (or the comment count) opens the
    // detail screen, confirmed from the real ReviewCard source.
    await tester.ensureVisible(find.text('Review Conversation'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Review Conversation'));
    await tester.pumpAndSettle();

    // RN marks a review read from the details screen (after 10s), not here.
    verifyNever(() => repository.markAsRead(any()));
    expect(find.text('review-detail-rev-42'), findsOneWidget);
  });
}
