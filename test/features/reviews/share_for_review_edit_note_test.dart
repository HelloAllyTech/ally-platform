import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/features/reviews/data/reviews_repository.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/share_for_review_screen.dart';

class MockReviewsRepository extends Mock implements ReviewsRepository {}

// One test per file — see `_review_details_test_fixtures.dart` for why.
void main() {
  testWidgets(
    'edit-note mode: real title/button, prefilled note, char counter, and a PATCH instead of a create',
    (tester) async {
      final repository = MockReviewsRepository();
      when(
        () => repository.updateReviewStatus(reviewId: 'rev-1', status: 'IN_REVIEW', note: 'updated note'),
      ).thenAnswer((_) async {});

      SharedPreferences.setMockInitialValues({});
      final router = GoRouter(
        initialLocation: '/share',
        routes: [
          GoRoute(
            path: '/',
            builder: (context, state) => const Text('home-screen'),
            routes: [GoRoute(path: 'share', builder: (context, state) => const ShareForReviewScreen(
              scenarioSessionId: 'sess-1',
              reviewId: 'rev-1',
              isEditNote: true,
              initialNote: 'original note',
            ))],
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

      // RN's real edit-mode title/button, not the create-mode defaults.
      expect(find.text('Edit note'), findsOneWidget);
      expect(find.text('Save'), findsOneWidget);
      expect(find.text('Share'), findsNothing);
      // The note is prefilled, and a live character counter is shown —
      // neither existed before.
      expect(find.text('original note'), findsOneWidget);
      expect(find.text('13/250'), findsOneWidget);

      await tester.enterText(find.byType(TextField), 'updated note');
      await tester.pump();
      expect(find.text('12/250'), findsOneWidget);

      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();

      verify(
        () => repository.updateReviewStatus(reviewId: 'rev-1', status: 'IN_REVIEW', note: 'updated note'),
      ).called(1);
      verifyNever(() => repository.createReview(scenarioSessionId: any(named: 'scenarioSessionId'), note: any(named: 'note')));
      expect(find.text('home-screen'), findsOneWidget);
    },
  );
}
