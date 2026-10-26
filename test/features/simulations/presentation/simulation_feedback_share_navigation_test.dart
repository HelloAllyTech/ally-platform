import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/widgets/app_button.dart';
import 'package:ally_mobile_flutter/core/routing/app_router.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulation_models.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulation_transcript_repository.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulations_repository.dart';
import 'package:ally_mobile_flutter/features/simulations/presentation/simulation_feedback_screen.dart';

import '../../../support/pump_router_app.dart';

class MockSimulationsRepository extends Mock implements SimulationsRepository {}

class MockSimulationTranscriptRepository extends Mock
    implements SimulationTranscriptRepository {}

// A dedicated file (not grouped into simulation_feedback_screen_test.dart)
// since this is the one scenario in that screen that needs a real
// `GoRouter` to tap through to — `context.push` throws "No GoRouter found
// in context" under that file's plain `pumpApp`.
void main() {
  testWidgets(
    'tapping Share for review passes the session\'s own date/duration as the share screen\'s context',
    (tester) async {
      final repository = MockSimulationsRepository();
      final transcriptRepository = MockSimulationTranscriptRepository();
      when(
        () => transcriptRepository.getMessages(
          scenarioSessionId: any(named: 'scenarioSessionId'),
          offset: any(named: 'offset'),
        ),
      ).thenAnswer((_) async => (messages: <SimulationTranscriptMessage>[], count: 0));
      when(() => repository.getSimulationDetails('session-1')).thenAnswer(
        (_) async => SimulationSummary.fromJson({
          'id': 'session-1',
          'startedAt': '2026-01-01T10:00:00.000Z',
          'endedAt': '2026-01-01T10:04:37.000Z',
        }),
      );
      when(
        () => repository.addSimulationFeedback(
          scenarioSessionId: 'session-1',
          rating: 4,
          comment: '',
          tags: <String>[],
        ),
      ).thenAnswer((_) async {});

      ShareForReviewArgs? capturedArgs;

      await pumpRouterApp(
        tester,
        initialLocation: '/feedback',
        routes: [
          GoRoute(
            path: '/feedback',
            builder: (context, state) => const SimulationFeedbackScreen(scenarioSessionId: 'session-1'),
          ),
          GoRoute(
            path: '/share-for-review/:scenarioSessionId',
            builder: (context, state) {
              capturedArgs = state.extra as ShareForReviewArgs?;
              return const Text('SHARE SCREEN');
            },
          ),
        ],
        overrides: [
          simulationsRepositoryProvider.overrideWithValue(repository),
          simulationTranscriptRepositoryProvider.overrideWithValue(transcriptRepository),
        ],
      );

      final starButtons = find.byIcon(Icons.star_border);
      await tester.tap(starButtons.at(3));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(AppButton, 'Submit'));
      await tester.pumpAndSettle();

      await tester.tap(find.widgetWithText(AppButton, 'Share for review'));
      await tester.pumpAndSettle();

      expect(find.text('SHARE SCREEN'), findsOneWidget);
      expect(capturedArgs?.contextDateTime, '2026-01-01T10:00:00.000Z');
      expect(capturedArgs?.contextDuration, '277');
      expect(capturedArgs?.reviewId, isNull);
    },
  );
}
