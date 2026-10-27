import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/widgets/app_button.dart';
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
  List<Map<String, Object?>>? availableLanguages,
}) => PathScenario.fromJson({
  'id': id,
  'scenarioId': scenarioId,
  'order': order,
  'title': title ?? 'Scenario $scenarioId',
  'status': status.name.toUpperCase(),
  'sessionId': sessionId,
  'availableLanguages': availableLanguages,
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
          onStartScenario: (_, {languageId}) async {},
          onViewFeedback: (_) async {},
        ),
      );

      expect(find.widgetWithText(AppButton, 'Start'), findsOneWidget);
      expect(find.widgetWithText(AppButton, 'Continue'), findsNothing);
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
          onStartScenario: (_, {languageId}) async {},
          onViewFeedback: (_) async {},
        ),
      );

      expect(find.widgetWithText(AppButton, 'Continue'), findsOneWidget);
      expect(find.widgetWithText(AppButton, 'Start'), findsNothing);
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
          onStartScenario: (_, {languageId}) async {},
          onViewFeedback: (_) async {},
        ),
      );

      final button = tester.widget<AppButton>(find.byType(AppButton));
      expect(button.isDisabled, isTrue);
    });

    testWidgets(
      'tapping it calls onEnsureSession then opens the preview modal, which calls '
      'onStartScenario for the next scenario once Start Simulation is tapped',
      (tester) async {
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
            onStartScenario: (scenario, {languageId}) async {
              calls.add('start:${scenario.id}');
            },
            onViewFeedback: (_) async {},
          ),
        );

        await tester.tap(find.widgetWithText(AppButton, 'Start'));
        await tester.pumpAndSettle();

        expect(calls, ['ensure'], reason: 'the preview modal is open; not started yet');
        expect(find.byKey(const Key('simulation-details-modal-start')), findsOneWidget);

        await tester.tap(find.byKey(const Key('simulation-details-modal-start')));
        await tester.pumpAndSettle();

        expect(calls, ['ensure', 'start:s1']);
        expect(find.byKey(const Key('simulation-details-modal-start')), findsNothing, reason: 'modal closed');
      },
    );

    testWidgets(
      'when the next scenario has availableLanguages, the preview modal offers a picker '
      'defaulting to the first option, and passes the chosen languageId through',
      (tester) async {
        int? capturedLanguageId;
        final details = _details(
          scenarios: [
            _scenario(
              id: 's1',
              scenarioId: 1,
              order: 1,
              availableLanguages: [
                {'language_id': 1, 'label': 'English', 'active': true},
                {'language_id': 2, 'label': 'Hindi', 'active': true},
              ],
            ),
          ],
        );

        await _pump(
          tester,
          LearningPathDetailView(
            details: details,
            onEnsureSession: () async {},
            onStartScenario: (scenario, {languageId}) async {
              capturedLanguageId = languageId;
            },
            onViewFeedback: (_) async {},
          ),
        );

        await tester.tap(find.widgetWithText(AppButton, 'Start'));
        await tester.pumpAndSettle();

        // Defaults to the first available language.
        expect(find.text('English'), findsOneWidget);

        await tester.tap(find.byKey(const Key('simulation-details-modal-language')));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Hindi').last);
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(const Key('simulation-details-modal-start')));
        await tester.pumpAndSettle();

        expect(capturedLanguageId, 2);
      },
    );

    testWidgets('closing the preview modal (the X button) does not start the scenario', (
      tester,
    ) async {
      var startCalls = 0;
      final details = _details(
        scenarios: [
          _scenario(
            id: 's1',
            scenarioId: 1,
            order: 1,
            availableLanguages: [
              {'language_id': 1, 'label': 'English', 'active': true},
            ],
          ),
        ],
      );

      await _pump(
        tester,
        LearningPathDetailView(
          details: details,
          onEnsureSession: () async {},
          onStartScenario: (scenario, {languageId}) async => startCalls++,
          onViewFeedback: (_) async {},
        ),
      );

      await tester.tap(find.widgetWithText(AppButton, 'Start'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('simulation-details-modal-start')), findsOneWidget);

      await tester.tap(find.byKey(const Key('simulation-details-modal-close')));
      await tester.pumpAndSettle();

      expect(startCalls, 0);
      expect(find.byKey(const Key('simulation-details-modal-start')), findsNothing);
    });

    testWidgets('a start failure shows the error inline inside the modal and keeps it open', (
      tester,
    ) async {
      final details = _details(scenarios: [_scenario(id: 's1', scenarioId: 1, order: 1)]);

      await _pump(
        tester,
        LearningPathDetailView(
          details: details,
          onEnsureSession: () async {},
          onStartScenario: (scenario, {languageId}) async => throw Exception('network down'),
          onViewFeedback: (_) async {},
        ),
      );

      await tester.tap(find.widgetWithText(AppButton, 'Start'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('simulation-details-modal-start')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('simulation-details-modal-start')), findsOneWidget, reason: 'stays open');
      expect(find.textContaining('network down'), findsOneWidget);
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
          onStartScenario: (scenario, {languageId}) async => calls.add(scenario.id),
          onViewFeedback: (_) async {},
        ),
      );

      // `find.byType(InkWell)` alone would also match AppButton's own
      // internal InkWell — disambiguate via the row's title text.
      final rowInkWell = tester.widget<InkWell>(
        find.ancestor(of: find.text('Scenario 1'), matching: find.byType(InkWell)),
      );
      expect(rowInkWell.onTap, isNull);

      await tester.tap(find.text('Scenario 1'));
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
          onStartScenario: (_, {languageId}) async {},
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
          onStartScenario: (scenario, {languageId}) async => calls.add(scenario.id),
          onViewFeedback: (_) async {},
        ),
      );

      await tester.tap(find.text('Scenario 2'));
      await tester.pumpAndSettle();
      expect(calls, isEmpty, reason: 'the preview modal is open; not started yet');

      await tester.tap(find.byKey(const Key('simulation-details-modal-start')));
      await tester.pumpAndSettle();

      expect(calls, ['s2']);
    });

    testWidgets('shows a lock overlay on a locked thumbnail and a Next badge on the resumable row', (
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
          _scenario(id: 's3', scenarioId: 3, order: 3, status: SessionItemStatus.locked),
        ],
      );

      await _pump(
        tester,
        LearningPathDetailView(
          details: details,
          onEnsureSession: () async {},
          onStartScenario: (_, {languageId}) async {},
          onViewFeedback: (_) async {},
        ),
      );

      // RN's real card: "Role play N" prefix, a Next badge only on the
      // first unlocked (resumable) scenario, and a dark lock overlay +
      // icon on a locked row's thumbnail — not a numbered circle avatar.
      expect(find.text('Role play 1'), findsOneWidget);
      expect(find.text('Role play 2'), findsOneWidget);
      expect(find.text('Next'), findsOneWidget, reason: 'only scenario 2 is the resumable one');
      expect(find.byIcon(Icons.lock), findsOneWidget, reason: 'only scenario 3 is locked');
    });
  });
}
