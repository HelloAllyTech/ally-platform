import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/data/reviews_repository.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/review_screen.dart';

import '../../support/pump_app.dart';

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
  // see those files' doc comments for why. NOTE on test order here: the
  // one test below that taps a review and asserts navigation needs a real
  // `GoRouter` ancestor (`ReviewScreen` navigates via `context.push`).
  // Pumping a `GoRouter`-backed `MaterialApp.router` was found
  // (empirically) to risk wedging `localizationControllerProvider` for
  // subsequent widget tests in the same file/isolate, so it's kept as the
  // last test here and nothing follows it — don't add more tests after it.

  testWidgets('shows an empty state when there are no reviews', (tester) async {
    when(() => repository.getReviews()).thenAnswer((_) async => []);

    await pumpApp(
      tester,
      const ReviewScreen(),
      overrides: [reviewsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.text('No shared sessions yet'), findsOneWidget);
  });

  testWidgets('renders review rows with note, summary name and comment count', (tester) async {
    when(() => repository.getReviews()).thenAnswer(
      (_) async => [review(id: 'rev-1', note: 'please check this', commentsCount: 4)],
    );

    await pumpApp(
      tester,
      const ReviewScreen(),
      overrides: [reviewsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.text('Alex'), findsOneWidget);
    expect(find.text('please check this'), findsOneWidget);
    expect(find.text('4'), findsOneWidget);
  });

  testWidgets('tapping a review marks it read and navigates to its detail route', (tester) async {
    when(() => repository.getReviews()).thenAnswer((_) async => [review(id: 'rev-42')]);
    when(() => repository.markAsRead('rev-42')).thenAnswer((_) async {});

    SharedPreferences.setMockInitialValues({});
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

    await tester.pumpWidget(
      ProviderScope(
        overrides: [reviewsRepositoryProvider.overrideWithValue(repository)],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Alex'));
    await tester.pumpAndSettle();

    verify(() => repository.markAsRead('rev-42')).called(1);
    expect(find.text('review-detail-rev-42'), findsOneWidget);
  });
}
