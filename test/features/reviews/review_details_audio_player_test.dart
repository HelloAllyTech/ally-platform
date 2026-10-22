import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/data/reviews_repository.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/review_details_screen.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/simulation_audio_player.dart';
import 'package:ally_mobile_flutter/core/widgets/review_type_chip.dart';

import '../../support/pump_app.dart';
import '_review_details_test_fixtures.dart';

ReviewItem _reviewWithAudio() => ReviewItem(
  id: 'rev-1',
  createdAt: '2026-01-01T00:00:00Z',
  note: 'please look at this session',
  createdBy: ReviewAuthor(id: 1, name: 'Dr. Patel', profileImage: ''),
  commentsCount: 2,
  summaryName: null,
  scenarioSession: ReviewScenarioSession(audioUrl: 'https://cdn.example.com/session.ogg'),
);

// See `_review_details_test_fixtures.dart` for why this is one test per
// file rather than grouped with the screen's other scenarios.
void main() {
  testWidgets('a simulation review with a scenarioSession.audioUrl renders the audio player', (
    tester,
  ) async {
    final repository = MockReviewsRepository();
    when(() => repository.getReview('rev-1')).thenAnswer((_) async => _reviewWithAudio());
    when(() => repository.getGeneralComments('rev-1')).thenAnswer((_) async => []);
    when(() => repository.getThreads('rev-1'))
        .thenAnswer((_) async => (threads: <ReviewThread>[], count: 0));

    await pumpApp(
      tester,
      const ReviewDetailsScreen(reviewId: 'rev-1', reviewType: ReviewType.simulation),
      overrides: [reviewsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.byType(SimulationAudioPlayer), findsOneWidget);
  });

  testWidgets('a simulation review with no scenarioSession at all shows no audio player', (
    tester,
  ) async {
    final repository = MockReviewsRepository();
    when(() => repository.getReview('rev-1')).thenAnswer((_) async => buildReview());
    when(() => repository.getGeneralComments('rev-1')).thenAnswer((_) async => []);
    when(() => repository.getThreads('rev-1'))
        .thenAnswer((_) async => (threads: <ReviewThread>[], count: 0));

    await pumpApp(
      tester,
      const ReviewDetailsScreen(reviewId: 'rev-1', reviewType: ReviewType.simulation),
      overrides: [reviewsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.byType(SimulationAudioPlayer), findsNothing);
  });
}
