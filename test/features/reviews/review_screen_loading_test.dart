import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';
import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/data/reviews_repository.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/review_screen.dart';

class MockReviewsRepository extends Mock implements ReviewsRepository {}

// Kept in its own file, separate from `review_screen_test.dart`'s other
// cases: a widget test that checks the loading state necessarily pumps a
// frame while `reviewsListProvider`'s future (and, more importantly,
// `localizationControllerProvider`'s own bundled-asset load) is still
// unresolved. That was found (empirically, via a minimal repro) to wedge
// `localizationControllerProvider` for every *subsequent* widget test in
// the same file/isolate — later ones would still pump fine, but every
// `ref.t()` call in them would fall back to showing its raw key forever,
// as if translations never finished loading again. Giving this test sole
// ownership of its file/isolate sidesteps the issue entirely without
// depending on pinning down the exact flutter_test root cause.
void main() {
  testWidgets('shows a loading indicator while reviews are fetching', (tester) async {
    final repository = MockReviewsRepository();
    final completer = Completer<List<ReviewItem>>();
    when(() => repository.getReviews()).thenAnswer((_) => completer.future);

    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          reviewsRepositoryProvider.overrideWithValue(repository),
          userPermissionsProvider.overrideWith(
            (ref) async => [
              UserPermissions.viewSimulationReviews,
              UserPermissions.viewSimulationReview,
            ],
          ),
        ],
        child: const MaterialApp(home: ReviewScreen()),
      ),
    );
    await tester.pump();

    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    completer.complete(<ReviewItem>[]);
  });
}
