import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/features/reviews/data/scribe_reviews_repository.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/share_for_review_screen.dart';

import '../../support/fake_translations.dart';

class MockScribeReviewsRepository extends Mock implements ScribeReviewsRepository {}

// One test per file, same discipline as `share_for_review_success_test.dart`.
void main() {
  testWidgets(
    'isScribe: true with a reviewId updates via the scribe endpoint and pops back',
    (tester) async {
      final repository = MockScribeReviewsRepository();
      when(
        () => repository.updateReviewStatus(
          reviewId: 'rev-9',
          status: 'IN_REVIEW',
          note: 'an updated note',
        ),
      ).thenAnswer((_) async {});

      SharedPreferences.setMockInitialValues({});
      final router = GoRouter(
        initialLocation: '/back',
        routes: [
          GoRoute(path: '/back', builder: (context, state) => const Text('back-screen')),
          GoRoute(
            path: '/share',
            builder: (context, state) => const ShareForReviewScreen(
              scenarioSessionId: '1001',
              reviewId: 'rev-9',
              isEditNote: true,
              isScribe: true,
            ),
          ),
        ],
      );
      addTearDown(router.dispose);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            fixedTranslationsOverride(),
            scribeReviewsRepositoryProvider.overrideWithValue(repository),
          ],
          child: MaterialApp.router(routerConfig: router),
        ),
      );
      await tester.pumpAndSettle();

      router.push('/share');
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField), 'an updated note');
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();

      verify(
        () => repository.updateReviewStatus(
          reviewId: 'rev-9',
          status: 'IN_REVIEW',
          note: 'an updated note',
        ),
      ).called(1);
      expect(find.text('back-screen'), findsOneWidget, reason: 'an edit just pops back');
    },
  );
}
