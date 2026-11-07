import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/core/routing/app_router.dart';
import 'package:ally_mobile_flutter/features/reviews/data/scribe_reviews_repository.dart';

import '../../support/fake_translations.dart';
import '../../support/pump_app.dart' show toastHostBuilder;

class MockScribeReviewsRepository extends Mock implements ScribeReviewsRepository {}

// One test per file, same discipline as `share_for_review_success_test.dart`.
// RN `useShareScreenLogic.handleShare`: a re-share from Call summary with an
// existing reviewId stays in share mode — "Share" button, status+note
// update, and the shared-for-review toast (not the edit-note one).
void main() {
  testWidgets('re-sharing an existing scribe review stays in share mode with the shared toast', (tester) async {
    final repository = MockScribeReviewsRepository();
    when(
      () => repository.updateReviewStatus(reviewId: 'rev-9', status: 'IN_REVIEW', note: 'draft'),
    ).thenAnswer((_) async {});

    SharedPreferences.setMockInitialValues({});
    final ShareForReviewArgs args = (
      reviewId: 'rev-9',
      isEditNote: false,
      note: 'draft',
      contextDateTime: null,
      contextDuration: '277',
      isScribe: true,
      contextTitle: 'Walk-in #1',
    );
    final router = GoRouter(
      initialLocation: '/back',
      routes: [
        GoRoute(path: '/back', builder: (context, state) => const Text('back-screen')),
        GoRoute(
          path: '/share-for-review/:id',
          builder: (context, state) => buildShareForReviewScreen(state.pathParameters['id']!, state.extra),
        ),
      ],
    );
    addTearDown(router.dispose);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [fixedTranslationsOverride(), scribeReviewsRepositoryProvider.overrideWithValue(repository)],
        child: MaterialApp.router(routerConfig: router, builder: toastHostBuilder),
      ),
    );
    await tester.pumpAndSettle();
    router.push('/share-for-review/1001', extra: args);
    await tester.pumpAndSettle();

    expect(find.text('Edit note'), findsNothing);
    expect(find.text('Save'), findsNothing);
    // Raw seconds formatted once on the card (RN `formatDurationFromSeconds`).
    expect(find.text('4:37 min'), findsOneWidget);

    await tester.tap(find.text('Share'));
    await tester.pump();
    await tester.pump();

    verify(() => repository.updateReviewStatus(reviewId: 'rev-9', status: 'IN_REVIEW', note: 'draft')).called(1);
    expect(find.text('Transcript shared for review'), findsOneWidget);
    expect(find.text('Note updated successfully'), findsNothing);
    await tester.pumpAndSettle(const Duration(seconds: 5));
    expect(find.text('back-screen'), findsOneWidget);
  });
}
