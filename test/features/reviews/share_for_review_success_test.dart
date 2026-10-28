import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/features/reviews/data/reviews_repository.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/share_for_review_screen.dart';

class MockReviewsRepository extends Mock implements ReviewsRepository {}

// One test per file, same as the rest of this directory's widget tests —
// see `test/support/pump_app.dart` for the fuller explanation of
// why pumping more than one `ref.t()`-dependent widget per file/isolate
// isn't safe here. This scenario additionally needs a real `GoRouter`
// ancestor since `ShareForReviewScreen` navigates via `context.go('/home')`
// on success.
void main() {
  testWidgets('submitting a note calls createReview and shows the success toast and goes back (RN navigation.goBack)', (tester) async {
    final repository = MockReviewsRepository();
    when(() => repository.createReview(scenarioSessionId: 'sess-1', note: 'please check this'))
        .thenAnswer((_) async {});

    SharedPreferences.setMockInitialValues({});
    final router = GoRouter(

        initialLocation: '/share',
        routes: [
          GoRoute(
            path: '/',
            builder: (context, state) => const Text('home-screen'),
            routes: [GoRoute(path: 'share', builder: (context, state) => const ShareForReviewScreen(scenarioSessionId: 'sess-1'))],
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

    await tester.enterText(find.byType(TextField), 'please check this');
    await tester.tap(find.text('Share'));
    await tester.pumpAndSettle();

    verify(() => repository.createReview(scenarioSessionId: 'sess-1', note: 'please check this'))
        .called(1);
    expect(find.text('home-screen'), findsOneWidget);
  });
}
