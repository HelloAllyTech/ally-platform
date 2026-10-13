import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/data/reviews_repository.dart';

/// Shared fixtures for `ReviewDetailsScreen`'s tests. Deliberately NOT a
/// `_test.dart` file (so `flutter test` doesn't try to run it as one) and
/// deliberately split one `testWidgets` per actual test *file* rather than
/// grouped under one `main()` — pumping `ReviewDetailsScreen` (it wraps a
/// `DefaultTabController`/`TabBar`) was found, empirically, to wedge
/// `localizationControllerProvider` for every widget test that runs
/// afterwards in the same file/isolate, the same class of issue documented
/// in `review_screen_loading_test.dart` / `review_screen_error_test.dart`,
/// but here triggered by ordinary `AsyncData`-only renders too — isolating
/// each scenario into its own file/isolate sidesteps it without depending
/// on pinning down the exact root cause.
class MockReviewsRepository extends Mock implements ReviewsRepository {}

ReviewItem buildReview() => ReviewItem(
      id: 'rev-1',
      createdAt: '2026-01-01T00:00:00Z',
      note: 'please look at this session',
      createdBy: ReviewAuthor(id: 1, name: 'Dr. Patel', profileImage: ''),
      commentsCount: 2,
      summaryName: null,
    );
