import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';
import 'package:ally_mobile_flutter/features/reviews/data/reviews_repository.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/review_screen.dart';

import '../../support/fake_translations.dart';
import '../../support/pump_app.dart' show toastHostBuilder;

class MockReviewsRepository extends Mock implements ReviewsRepository {}

// Kept in its own file, separate from `review_screen_test.dart`'s other
// cases: a `reviewsListProvider` that resolves to `AsyncError` was found
// (empirically, via a minimal repro) to wedge
// `localizationControllerProvider` for every *subsequent* widget test in
// the same file/isolate — later ones would still pump fine, but every
// `ref.t()` call in them would fall back to showing its raw key forever.
// Giving this test sole ownership of its file/isolate sidesteps the issue
// without depending on pinning down the exact flutter_test/riverpod root
// cause. See also `review_screen_loading_test.dart`, which has the same
// issue for a provider that never settles at all.
void main() {
  testWidgets('shows RN\'s review.error.title error toast when the fetch fails', (tester) async {
    final repository = MockReviewsRepository();
    // `.thenAnswer((_) async => throw ...)`, not `.thenThrow(...)` — the
    // latter makes the mocked (Future-returning) method throw
    // *synchronously* rather than returning a rejected Future, which
    // leaves Riverpod's `FutureProvider` wedged in an intermediate
    // `AsyncLoading(error: ..., stackTrace: ...)` state that no amount of
    // `pump()`/`pumpAndSettle()` ever flushes to a proper `AsyncError`.
    when(() => repository.getReviews(readFilter: any(named: 'readFilter'), sortBy: any(named: 'sortBy'), limit: any(named: 'limit'), offset: any(named: 'offset'))).thenAnswer((_) async => throw Exception('network down'));

    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          fixedTranslationsOverride(),
          reviewsRepositoryProvider.overrideWithValue(repository),
          userPermissionsProvider.overrideWith(
            (ref) async => [
              UserPermissions.viewSimulationReviews,
              UserPermissions.viewSimulationReview,
            ],
          ),
        ],
        child: const MaterialApp(home: ReviewScreen(), builder: toastHostBuilder),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('Unable to Load Reviews'), findsOneWidget);
  });
}
