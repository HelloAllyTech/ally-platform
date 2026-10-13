import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/simulations/data/simulation_models.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulation_transcript_repository.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulations_repository.dart';
import 'package:ally_mobile_flutter/features/simulations/presentation/simulation_feedback_screen.dart';

import '../../../support/fake_translations.dart';
import '../../../support/pump_app.dart';

class MockSimulationsRepository extends Mock implements SimulationsRepository {}

class MockSimulationTranscriptRepository extends Mock
    implements SimulationTranscriptRepository {}

void main() {
  late MockSimulationsRepository repository;
  late MockSimulationTranscriptRepository transcriptRepository;

  setUp(() {
    repository = MockSimulationsRepository();
    transcriptRepository = MockSimulationTranscriptRepository();
    // The Transcript tab's content is built eagerly by `TabBarView` even
    // while the Debrief tab is the one showing, so it always needs a stub.
    when(
      () => transcriptRepository.getMessages(
        scenarioSessionId: any(named: 'scenarioSessionId'),
        offset: any(named: 'offset'),
      ),
    ).thenAnswer((_) async => (messages: <SimulationTranscriptMessage>[], count: 0));
  });

  Future<void> pumpScreen(WidgetTester tester) => pumpApp(
    tester,
    const SimulationFeedbackScreen(scenarioSessionId: 'session-1'),
    overrides: [
      fixedTranslationsOverride(),
      simulationsRepositoryProvider.overrideWithValue(repository),
      simulationTranscriptRepositoryProvider.overrideWithValue(transcriptRepository),
    ],
  );

  testWidgets('shows both the Debrief and Transcript tabs', (tester) async {
    when(() => repository.getSimulationDetails('session-1')).thenAnswer(
      (_) async => SimulationSummary.fromJson({
        'id': 'session-1',
        'startedAt': '2026-01-01T10:00:00.000Z',
      }),
    );

    await pumpScreen(tester);

    expect(find.text('Debrief'), findsOneWidget);
    expect(find.text('Transcript'), findsOneWidget);
  });

  testWidgets('renders the AI debrief summary (score, duration, well/improve lists)', (
    tester,
  ) async {
    when(() => repository.getSimulationDetails('session-1')).thenAnswer(
      (_) async => SimulationSummary.fromJson({
        'id': 'session-1',
        'score': 87,
        'startedAt': '2026-01-01T10:00:00.000Z',
        'endedAt': '2026-01-01T10:20:00.000Z',
        'whatWentWell': ['Good pacing'],
        'areasForImprovement': ['Ask more open questions'],
      }),
    );

    await pumpScreen(tester);

    expect(find.text('87'), findsOneWidget);
    expect(find.text('20 min session'), findsOneWidget);
    expect(find.text('Good pacing'), findsOneWidget);
    expect(find.text('Ask more open questions'), findsOneWidget);
  });

  testWidgets('requires a rating before submitting', (tester) async {
    when(() => repository.getSimulationDetails('session-1')).thenAnswer(
      (_) async => SimulationSummary.fromJson({
        'id': 'session-1',
        'startedAt': '2026-01-01T10:00:00.000Z',
      }),
    );

    await pumpScreen(tester);

    await tester.tap(find.widgetWithText(FilledButton, 'Submit'));
    await tester.pumpAndSettle();

    expect(find.text('Please select a rating.'), findsOneWidget);
    verifyNever(
      () => repository.addSimulationFeedback(
        scenarioSessionId: any(named: 'scenarioSessionId'),
        rating: any(named: 'rating'),
        comment: any(named: 'comment'),
      ),
    );
  });

  testWidgets('submitting a rating and comment calls addSimulationFeedback and shows the thanks state', (
    tester,
  ) async {
    when(() => repository.getSimulationDetails('session-1')).thenAnswer(
      (_) async => SimulationSummary.fromJson({
        'id': 'session-1',
        'startedAt': '2026-01-01T10:00:00.000Z',
      }),
    );
    when(
      () => repository.addSimulationFeedback(
        scenarioSessionId: 'session-1',
        rating: 4,
        comment: 'Really helpful session',
      ),
    ).thenAnswer((_) async {});

    await pumpScreen(tester);

    // 5 star IconButtons rendered left-to-right for ratings 1..5 — tap the
    // 4th to select a rating of 4.
    final starButtons = find.byIcon(Icons.star_border);
    await tester.tap(starButtons.at(3));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'Really helpful session');
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, 'Submit'));
    await tester.pumpAndSettle();

    verify(
      () => repository.addSimulationFeedback(
        scenarioSessionId: 'session-1',
        rating: 4,
        comment: 'Really helpful session',
      ),
    ).called(1);
    expect(find.text('Feedback submitted successfully'), findsOneWidget);
  });
}
