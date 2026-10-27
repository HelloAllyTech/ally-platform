import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';
import 'package:ally_mobile_flutter/features/reactions/data/reactions_repository.dart';
import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/data/reviews_repository.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulation_models.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulation_transcript_repository.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulations_repository.dart';
import 'package:ally_mobile_flutter/features/simulations/presentation/simulation_feedback_screen.dart';

import '../../../support/pump_router_app.dart';

class MockSimulationsRepository extends Mock implements SimulationsRepository {}

class MockSimulationTranscriptRepository extends Mock implements SimulationTranscriptRepository {}

class MockReviewsRepository extends Mock implements ReviewsRepository {}

class MockReactionsRepository extends Mock implements ReactionsRepository {}

SimulationSummary _summary({String? reviewId, String? reviewStatus}) => SimulationSummary.fromJson({
  'id': 'session-1',
  'startedAt': '2026-01-01T10:00:00.000Z',
  'reviewId': reviewId,
  'reviewStatus': reviewStatus,
});

Future<GoRouter> _pump(
  WidgetTester tester, {
  required MockSimulationsRepository repository,
  required MockSimulationTranscriptRepository transcriptRepository,
  required MockReviewsRepository reviewsRepository,
  required MockReactionsRepository reactionsRepository,
  List<String> permissions = const [UserPermissions.viewSimulationReview],
}) async {
  final router = await pumpRouterApp(
    tester,
    initialLocation: '/feedback',
    routes: [
      GoRoute(
        path: '/feedback',
        builder: (context, state) => const SimulationFeedbackScreen(scenarioSessionId: 'session-1'),
      ),
      GoRoute(
        path: '/reviews/:reviewId',
        builder: (context, state) =>
            Text('REVIEW_DETAILS:${state.pathParameters['reviewId']}:${state.extra}'),
      ),
    ],
    overrides: [
      simulationsRepositoryProvider.overrideWithValue(repository),
      simulationTranscriptRepositoryProvider.overrideWithValue(transcriptRepository),
      reviewsRepositoryProvider.overrideWithValue(reviewsRepository),
      reactionsRepositoryProvider.overrideWithValue(reactionsRepository),
      userPermissionsProvider.overrideWith((ref) async => permissions),
    ],
  );
  return router;
}

void main() {
  late MockSimulationsRepository repository;
  late MockSimulationTranscriptRepository transcriptRepository;
  late MockReviewsRepository reviewsRepository;
  late MockReactionsRepository reactionsRepository;

  setUp(() {
    repository = MockSimulationsRepository();
    transcriptRepository = MockSimulationTranscriptRepository();
    reviewsRepository = MockReviewsRepository();
    reactionsRepository = MockReactionsRepository();
    when(
      () => transcriptRepository.getMessages(
        scenarioSessionId: any(named: 'scenarioSessionId'),
        offset: any(named: 'offset'),
      ),
    ).thenAnswer((_) async => (messages: <SimulationTranscriptMessage>[], count: 0));
    when(
      () => reviewsRepository.getThreads(any(), limit: any(named: 'limit')),
    ).thenAnswer((_) async => (threads: const <ReviewThread>[], count: 0));
    when(() => reactionsRepository.getReactionsCount(any())).thenAnswer((_) async => <String, int>{});
  });

  testWidgets('no reviewId at all: the floating review button never shows', (tester) async {
    when(() => repository.getSimulationDetails('session-1')).thenAnswer((_) async => _summary());

    await _pump(
      tester,
      repository: repository,
      transcriptRepository: transcriptRepository,
      reviewsRepository: reviewsRepository,
      reactionsRepository: reactionsRepository,
    );

    expect(find.byKey(const Key('simulation-feedback-view-review')), findsNothing);
  });

  testWidgets('a non-private review: the button shows immediately, even on the Debrief tab is hidden', (
    tester,
  ) async {
    when(
      () => repository.getSimulationDetails('session-1'),
    ).thenAnswer((_) async => _summary(reviewId: 'rev-1', reviewStatus: 'IN_REVIEW'));

    await _pump(
      tester,
      repository: repository,
      transcriptRepository: transcriptRepository,
      reviewsRepository: reviewsRepository,
      reactionsRepository: reactionsRepository,
    );

    // Starts on the Debrief tab (index 0) — RN never shows the button there.
    expect(find.byKey(const Key('simulation-feedback-view-review')), findsNothing);
    // Threads/reactions are never even checked for a non-private review.
    verifyNever(() => reviewsRepository.getThreads(any(), limit: any(named: 'limit')));

    await tester.tap(find.text('Transcript'));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('simulation-feedback-view-review')), findsOneWidget);
  });

  testWidgets('a private review with no threads or reactions: the button stays hidden', (tester) async {
    when(
      () => repository.getSimulationDetails('session-1'),
    ).thenAnswer((_) async => _summary(reviewId: 'rev-1', reviewStatus: 'HIDDEN'));

    await _pump(
      tester,
      repository: repository,
      transcriptRepository: transcriptRepository,
      reviewsRepository: reviewsRepository,
      reactionsRepository: reactionsRepository,
    );

    await tester.tap(find.text('Transcript'));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('simulation-feedback-view-review')), findsNothing);
    verify(() => reviewsRepository.getThreads('rev-1', limit: 1)).called(1);
  });

  testWidgets('a private review with an existing thread: the button shows anyway', (tester) async {
    when(
      () => repository.getSimulationDetails('session-1'),
    ).thenAnswer((_) async => _summary(reviewId: 'rev-1', reviewStatus: 'HIDDEN'));
    when(() => reviewsRepository.getThreads('rev-1', limit: 1)).thenAnswer(
      (_) async => (
        threads: [
          ReviewThread.fromJson({
            'id': 'thread-1',
            'commentCount': 1,
            'createdBy': {'id': 1, 'name': 'A'},
          }),
        ],
        count: 1,
      ),
    );

    await _pump(
      tester,
      repository: repository,
      transcriptRepository: transcriptRepository,
      reviewsRepository: reviewsRepository,
      reactionsRepository: reactionsRepository,
    );

    await tester.tap(find.text('Transcript'));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('simulation-feedback-view-review')), findsOneWidget);
    // Already resolved by the thread check — reactions are never checked.
    verifyNever(() => reactionsRepository.getReactionsCount(any()));
  });

  testWidgets('a private review with no threads but a reaction: the button shows', (tester) async {
    when(
      () => repository.getSimulationDetails('session-1'),
    ).thenAnswer((_) async => _summary(reviewId: 'rev-1', reviewStatus: 'HIDDEN'));
    when(
      () => reactionsRepository.getReactionsCount('rev-1'),
    ).thenAnswer((_) async => {'👍': 1});

    await _pump(
      tester,
      repository: repository,
      transcriptRepository: transcriptRepository,
      reviewsRepository: reviewsRepository,
      reactionsRepository: reactionsRepository,
    );

    await tester.tap(find.text('Transcript'));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('simulation-feedback-view-review')), findsOneWidget);
  });

  testWidgets('without the viewSimulationReview permission: the button never shows', (tester) async {
    when(
      () => repository.getSimulationDetails('session-1'),
    ).thenAnswer((_) async => _summary(reviewId: 'rev-1', reviewStatus: 'IN_REVIEW'));

    await _pump(
      tester,
      repository: repository,
      transcriptRepository: transcriptRepository,
      reviewsRepository: reviewsRepository,
      reactionsRepository: reactionsRepository,
      permissions: const [],
    );

    await tester.tap(find.text('Transcript'));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('simulation-feedback-view-review')), findsNothing);
  });

  testWidgets('tapping the button navigates to ReviewDetailsScreen with ReviewType.simulation', (
    tester,
  ) async {
    when(
      () => repository.getSimulationDetails('session-1'),
    ).thenAnswer((_) async => _summary(reviewId: 'rev-1', reviewStatus: 'IN_REVIEW'));

    await _pump(
      tester,
      repository: repository,
      transcriptRepository: transcriptRepository,
      reviewsRepository: reviewsRepository,
      reactionsRepository: reactionsRepository,
    );

    await tester.tap(find.text('Transcript'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('simulation-feedback-view-review')));
    await tester.pumpAndSettle();

    expect(find.text('REVIEW_DETAILS:rev-1:ReviewType.simulation'), findsOneWidget);
  });
}
