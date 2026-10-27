import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/account/data/account_repository.dart';
import 'package:ally_mobile_flutter/features/account/data/user_profile.dart';
import 'package:ally_mobile_flutter/features/reactions/data/reactions_repository.dart';
import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/data/reviews_repository.dart';

/// Shared fixtures for `ThreadDetailScreen`'s tests. Deliberately NOT a
/// `_test.dart` file (so `flutter test` doesn't try to run it as one) and
/// deliberately one `testWidgets` per actual test *file* — see
/// `_review_details_test_fixtures.dart` for the fuller explanation (same
/// class of issue: pumping any `ref.t()`-dependent widget here was found,
/// empirically, to wedge `localizationControllerProvider` for whichever
/// widget test in the same file/isolate runs next, even for ordinary
/// `AsyncData` renders).
class MockReviewsRepository extends Mock implements ReviewsRepository {}

class MockReactionsRepository extends Mock implements ReactionsRepository {}

ThreadComment buildComment({
  required String id,
  required String content,
  required String authorName,
  Map<String, int> reactions = const {},
  String? myReaction,
  int? authorId,
  bool hidden = false,
  String? createdAt,
}) =>
    ThreadComment(
      id: id,
      content: content,
      createdAt: createdAt,
      authorName: authorName,
      reactions: reactions,
      myReaction: myReaction,
      authorId: authorId,
      hidden: hidden,
    );

List<Override> threadDetailOverrides(
  MockReviewsRepository reviewsRepository,
  MockReactionsRepository reactionsRepository, {
  int? currentUserId,
}) => [
  reviewsRepositoryProvider.overrideWithValue(reviewsRepository),
  reactionsRepositoryProvider.overrideWithValue(reactionsRepository),
  if (currentUserId != null)
    currentUserProvider.overrideWith(
      (ref) async => UserProfile(
        id: currentUserId,
        email: 'me@example.com',
        name: 'Me',
        phone: '',
        profileImageUrl: null,
        profileCompleted: true,
      ),
    ),
];
