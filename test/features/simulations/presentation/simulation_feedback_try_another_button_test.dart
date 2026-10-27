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

SimulationSummary _summary() => SimulationSummary.fromJson({
  'id': 'session-1',
  'startedAt': '2026-01-01T10:00:00.000Z',
});

Future<GoRouter> _pump(
  WidgetTester tester, {
  required MockSimulationsRepository repository,
  required MockSimulationTranscriptRepository transcriptRepository,
  required MockReviewsRepository reviewsRepository,
  required MockReactionsRepository reactionsRepository,
  bool fromLogs = false,
}) async {
  final router = await pumpRouterApp(
    tester,
    initialLocation: '/feedback',
    routes: [
      GoRoute(
        path: '/feedback',
        builder: (context, state) =>
            SimulationFeedbackScreen(scenarioSessionId: 'session-1', fromLogs: fromLogs),
      ),
      GoRoute(path: '/simulations', builder: (context, state) => const Text('SIMULATIONS_LIST')),
    ],
    overrides: [
      simulationsRepositoryProvider.overrideWithValue(repository),
      simulationTranscriptRepositoryProvider.overrideWithValue(transcriptRepository),
      reviewsRepositoryProvider.overrideWithValue(reviewsRepository),
      reactionsRepositoryProvider.overrideWithValue(reactionsRepository),
      userPermissionsProvider.overrideWith((ref) async => const [UserPermissions.viewSimulationReview]),
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
    when(() => repository.getSimulationDetails('session-1')).thenAnswer((_) async => _summary());
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

  testWidgets('hidden on the Debrief tab even when every other condition is met', (tester) async {
    await _pump(
      tester,
      repository: repository,
      transcriptRepository: transcriptRepository,
      reviewsRepository: reviewsRepository,
      reactionsRepository: reactionsRepository,
    );

    expect(find.byKey(const Key('simulation-feedback-try-another')), findsNothing);
  });

  testWidgets('shows on the Transcript tab once the summary has loaded, not fromLogs', (tester) async {
    await _pump(
      tester,
      repository: repository,
      transcriptRepository: transcriptRepository,
      reviewsRepository: reviewsRepository,
      reactionsRepository: reactionsRepository,
    );

    await tester.tap(find.text('Transcript'));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('simulation-feedback-try-another')), findsOneWidget);
    expect(find.text('Try another simulation'), findsOneWidget);
  });

  testWidgets('never shows when opened fromLogs, even on the Transcript tab', (tester) async {
    await _pump(
      tester,
      repository: repository,
      transcriptRepository: transcriptRepository,
      reviewsRepository: reviewsRepository,
      reactionsRepository: reactionsRepository,
      fromLogs: true,
    );

    await tester.tap(find.text('Transcript'));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('simulation-feedback-try-another')), findsNothing);
  });

  testWidgets('tapping it navigates to the simulations catalog, not the rating popup', (tester) async {
    await _pump(
      tester,
      repository: repository,
      transcriptRepository: transcriptRepository,
      reviewsRepository: reviewsRepository,
      reactionsRepository: reactionsRepository,
    );

    await tester.tap(find.text('Transcript'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('simulation-feedback-try-another')));
    await tester.pumpAndSettle();

    expect(find.text('SIMULATIONS_LIST'), findsOneWidget);
  });
}
