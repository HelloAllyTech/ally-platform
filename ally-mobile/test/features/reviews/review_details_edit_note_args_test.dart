import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';
import 'package:ally_mobile_flutter/core/widgets/review_type_chip.dart';
import 'package:ally_mobile_flutter/features/account/data/account_repository.dart';
import 'package:ally_mobile_flutter/features/account/data/user_profile.dart';
import 'package:ally_mobile_flutter/features/reviews/data/review_api.dart';
import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/data/scribe_reviews_repository.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/review_details_screen.dart';

import '../../support/fake_translations.dart';

class _MockApi extends Mock implements ReviewApi {}

class _MockScribeReviews extends Mock implements ScribeReviewsRepository {}

final _owner = UserProfile(
  id: 1,
  email: 'a@example.com',
  name: 'Asha',
  phone: '',
  profileImageUrl: null,
  profileCompleted: true,
);

// RN `ScribeReviewDetailsScreen.handleEditNote`: navigates with
// `isEditNote: true` and `title: summaryName || 'Session Review'`.
void main() {
  testWidgets('scribe Edit note opens the share screen in edit mode, titled "Session Review" when unnamed', (
    tester,
  ) async {
    final api = _MockApi();
    final scribeReviews = _MockScribeReviews();
    when(() => api.getMessages(any(), offset: any(named: 'offset'), limit: any(named: 'limit')))
        .thenAnswer((_) async => const []);
    when(() => api.getGeneralComments(any(), offset: any(named: 'offset'), limit: any(named: 'limit')))
        .thenAnswer((_) async => (comments: const <ThreadComment>[], count: 0));
    when(() => scribeReviews.getScribeReview('rev-1')).thenAnswer(
      (_) async => ReviewItem(
        id: 'rev-1',
        createdAt: DateTime.now().toUtc().toIso8601String(),
        note: 'Please look',
        createdBy: ReviewAuthor(id: 1, name: 'Asha', profileImage: ''),
        commentsCount: 0,
        summaryName: '',
        reviewStatus: 'IN_REVIEW',
        scenario: null,
        scenarioSession: null,
        scribeSession: ReviewScribeSession(summaryName: null, duration: '120'),
        reactions: const {},
        generalCommentsThreadId: 'g-1',
      ),
    );
    when(() => scribeReviews.markAsRead('rev-1')).thenAnswer((_) async {});

    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize = const Size(1206, 2622);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final router = GoRouter(
      initialLocation: '/review',
      routes: [
        GoRoute(
          path: '/review',
          builder: (context, state) => const ReviewDetailsScreen(reviewId: 'rev-1', reviewType: ReviewType.scribe),
        ),
        GoRoute(
          path: '/share-for-review/:id',
          builder: (context, state) => Text('SHARE:${state.extra}'),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          fixedTranslationsOverride(),
          reviewApiProvider(ReviewType.scribe).overrideWithValue(api),
          scribeReviewsRepositoryProvider.overrideWithValue(scribeReviews),
          currentUserProvider.overrideWith((ref) async => _owner),
          userPermissionsProvider.overrideWith((ref) async => [UserPermissions.editScribeReview]),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('review-note-edit')));
    await tester.pumpAndSettle();

    expect(find.textContaining('isEditNote: true'), findsOneWidget);
    expect(find.textContaining('contextTitle: Session Review'), findsOneWidget);
    // Let the 10s mark-read timer fire so none is left pending.
    await tester.pump(const Duration(seconds: 11));
  });
}
