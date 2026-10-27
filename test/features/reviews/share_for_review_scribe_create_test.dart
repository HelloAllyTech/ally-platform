import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/features/reviews/data/scribe_reviews_repository.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/share_for_review_screen.dart';

class MockScribeReviewsRepository extends Mock implements ScribeReviewsRepository {}

// One test per file, same discipline as `share_for_review_success_test.dart`
// (see `_review_details_test_fixtures.dart`). Regression test for a real
// bug found while porting CallSummaryScreen's header: this screen used to
// always call the SIMULATION review endpoints even with `isScribe: true`.
void main() {
  testWidgets(
    'isScribe: true with no reviewId creates via the scribe endpoint and lands on the new review',
    (tester) async {
      final repository = MockScribeReviewsRepository();
      when(() => repository.createReview(scribeSessionId: 1001, note: 'please check this'))
          .thenAnswer((_) async => 'rev-new');

      SharedPreferences.setMockInitialValues({});
      final router = GoRouter(
        initialLocation: '/',
        routes: [
          GoRoute(
            path: '/',
            builder: (context, state) =>
                const ShareForReviewScreen(scenarioSessionId: '1001', isScribe: true),
          ),
          GoRoute(
            path: '/reviews/:reviewId',
            builder: (context, state) => Text('review-details-${state.pathParameters['reviewId']}'),
          ),
        ],
      );
      addTearDown(router.dispose);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [scribeReviewsRepositoryProvider.overrideWithValue(repository)],
          child: MaterialApp.router(routerConfig: router),
        ),
      );
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField), 'please check this');
      await tester.tap(find.text('Share'));
      await tester.pumpAndSettle();

      verify(() => repository.createReview(scribeSessionId: 1001, note: 'please check this'))
          .called(1);
      expect(find.text('review-details-rev-new'), findsOneWidget);
    },
  );
}
