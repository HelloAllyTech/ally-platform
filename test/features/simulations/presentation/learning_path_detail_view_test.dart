import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/simulations/data/simulation_models.dart';
import 'package:ally_mobile_flutter/features/simulations/presentation/learning_path_detail_view.dart';

import '../../../support/fake_translations.dart';
import '../../../support/pump_app.dart';

PathScenario _scenario({
  required String id,
  required int scenarioId,
  required int order,
  SessionItemStatus status = SessionItemStatus.unlocked,
  String? sessionId,
  String? title,
}) => PathScenario.fromJson({
  'id': id,
  'scenarioId': scenarioId,
  'order': order,
  'title': title ?? 'Scenario $scenarioId',
  'status': status.name.toUpperCase(),
  'sessionId': sessionId,
});

SimulationPathDetails _details({
  required List<PathScenario> scenarios,
  int completedScenarios = 0,
}) => SimulationPathDetails(
  id: 'path-1',
  title: 'My Path',
  description: 'Path description',
  coverImageUrl: null,
  completedScenarios: completedScenarios,
  completedAt: null,
  scenarioPathSessionId: null,
  caseSessionId: null,
  scenarios: scenarios,
);

Future<void> _pump(WidgetTester tester, Widget child) =>
    pumpApp(tester, child, overrides: [fixedTranslationsOverride()]);

void main() {
  group('Start/Continue button', () {
    testWidgets('shows Start when no scenario has been completed yet', (
      tester,
    ) async {
      final details = _details(
        scenarios: [
          _scenario(id: 's1', scenarioId: 1, order: 1),
          _scenario(id: 's2', scenarioId: 2, order: 2),
        ],
      );

      await _pump(
        tester,
        LearningPathDetailView(
          details: details,
          onEnsureSession: () async {},
          onStartScenario: (_) async {},
          onViewFeedback: (_) async {},
        ),
      );

      expect(find.widgetWithText(FilledButton, 'Start'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Continue'), findsNothing);
    });

    testWidgets('flips to Continue once any scenario is completed', (
      tester,
    ) async {
      final details = _details(
        completedScenarios: 1,
        scenarios: [
          _scenario(
            id: 's1',
            scenarioId: 1,
            order: 1,
            status: SessionItemStatus.completed,
            sessionId: 'sess-1',
          ),
          _scenario(id: 's2', scenarioId: 2, order: 2),
        ],
      );

      await _pump(
        tester,
        LearningPathDetailView(
          details: details,
          onEnsureSession: () async {},
          onStartScenario: (_) async {},
          onViewFeedback: (_) async {},
        ),
      );

      expect(find.widgetWithText(FilledButton, 'Continue'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Start'), findsNothing);
    });

    testWidgets('is disabled when there is no next scenario', (tester) async {
      final details = _details(
        completedScenarios: 1,
        scenarios: [
          _scenario(
            id: 's1',
            scenarioId: 1,
            order: 1,
            status: SessionItemStatus.completed,
            sessionId: 'sess-1',
          ),
          _scenario(id: 's2', scenarioId: 2, order: 2, status: SessionItemStatus.locked),
        ],
      );

      await _pump(
        tester,
        LearningPathDetailView(
          details: details,
          onEnsureSession: () async {},
          onStartScenario: (_) async {},
          onViewFeedback: (_) async {},
        ),
      );

      final button = tester.widget<FilledButton>(find.byType(FilledButton));
      expect(button.onPressed, isNull);
    });

    testWidgets('tapping it calls onEnsureSession then onStartScenario with the next scenario', (
      tester,
    ) async {
      final calls = <String>[];
      final details = _details(
        scenarios: [
          _scenario(id: 's1', scenarioId: 1, order: 1),
          _scenario(id: 's2', scenarioId: 2, order: 2),
        ],
      );

      await _pump(
        tester,
        LearningPathDetailView(
          details: details,
          onEnsureSession: () async {
            calls.add('ensure');
          },
          onStartScenario: (scenario) async {
            calls.add('start:${scenario.id}');
          },
          onViewFeedback: (_) async {},
        ),
      );

      await tester.tap(find.widgetWithText(FilledButton, 'Start'));
      await tester.pumpAndSettle();

      expect(calls, ['ensure', 'start:s1']);
    });
  });

  group('per-row status rendering', () {
    testWidgets('a locked row is disabled and not tappable', (tester) async {
      final calls = <String>[];
      final details = _details(
        scenarios: [
          _scenario(id: 's1', scenarioId: 1, order: 1, status: SessionItemStatus.locked),
        ],
      );

      await _pump(
        tester,
        LearningPathDetailView(
          details: details,
          onEnsureSession: () async {},
          onStartScenario: (scenario) async => calls.add(scenario.id),
          onViewFeedback: (_) async {},
        ),
      );

      final tile = tester.widget<ListTile>(find.byType(ListTile));
      expect(tile.enabled, isFalse);
      expect(tile.onTap, isNull);

      await tester.tap(find.byType(ListTile));
      await tester.pumpAndSettle();
      expect(calls, isEmpty);
    });

    testWidgets('a completed row with a sessionId shows a view-feedback action', (
      tester,
    ) async {
      final calls = <String>[];
      final details = _details(
        completedScenarios: 1,
        scenarios: [
          _scenario(
            id: 's1',
            scenarioId: 1,
            order: 1,
            status: SessionItemStatus.completed,
            sessionId: 'sess-1',
          ),
        ],
      );

      await _pump(
        tester,
        LearningPathDetailView(
          details: details,
          onEnsureSession: () async {},
          onStartScenario: (_) async {},
          onViewFeedback: (scenario) async => calls.add(scenario.id),
        ),
      );

      expect(find.byIcon(Icons.description_outlined), findsOneWidget);
      await tester.tap(find.byIcon(Icons.description_outlined));
      await tester.pumpAndSettle();

      expect(calls, ['s1']);
    });

    testWidgets('tapping a non-locked row calls onStartScenario for that specific scenario', (
      tester,
    ) async {
      final calls = <String>[];
      final details = _details(
        scenarios: [
          _scenario(id: 's1', scenarioId: 1, order: 1),
          _scenario(id: 's2', scenarioId: 2, order: 2),
        ],
      );

      await _pump(
        tester,
        LearningPathDetailView(
          details: details,
          onEnsureSession: () async {},
          onStartScenario: (scenario) async => calls.add(scenario.id),
          onViewFeedback: (_) async {},
        ),
      );

      await tester.tap(find.widgetWithText(ListTile, 'Scenario 2'));
      await tester.pumpAndSettle();

      expect(calls, ['s2']);
    });
  });
}
