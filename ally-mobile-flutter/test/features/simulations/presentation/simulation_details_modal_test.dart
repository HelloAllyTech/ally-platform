import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/simulations/data/simulation_models.dart';
import 'package:ally_mobile_flutter/features/simulations/presentation/simulation_details_modal.dart';

import '../../../support/fake_translations.dart';
import '../../../support/pump_app.dart';

PathScenario _scenario({
  String? title = 'A hard conversation',
  String? description = 'Practice responding to a distressed client.',
  int order = 2,
  List<String> triggerWarnings = const [],
  List<Map<String, Object?>>? availableLanguages,
}) => PathScenario.fromJson({
  'id': 's1',
  'scenarioId': 1,
  'order': order,
  'title': title,
  'description': description,
  'status': 'UNLOCKED',
  'sessionId': null,
  'triggerWarnings': triggerWarnings.map((name) => {'id': name, 'name': name}).toList(),
  'availableLanguages': availableLanguages,
});

/// Pumps the modal directly as the opened dialog content (not behind a
/// trigger button) — exercising it exactly as `SimulationDetailsModal.show`
/// would render it, without needing a host screen.
Future<void> _pump(
  WidgetTester tester, {
  required PathScenario scenario,
  required Future<void> Function(int? languageId) onStart,
}) async {
  await pumpApp(
    tester,
    Builder(
      builder: (context) => Center(
        child: ElevatedButton(
          onPressed: () => SimulationDetailsModal.show(context, scenario: scenario, onStart: (languageId, _) => onStart(languageId)),
          child: const Text('open'),
        ),
      ),
    ),
    overrides: [fixedTranslationsOverride()],
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('renders order, title, scenario description, and no trigger-warnings section', (
    tester,
  ) async {
    await _pump(tester, scenario: _scenario(), onStart: (_) async {});

    expect(find.textContaining('Role play 2'), findsOneWidget);
    expect(find.text('A hard conversation'), findsOneWidget);
    expect(find.text('Situation'), findsOneWidget);
    expect(find.text('Practice responding to a distressed client.'), findsOneWidget);
    expect(find.textContaining('Trigger warnings'), findsNothing);
  });

  testWidgets('shows trigger-warning chips when the scenario has any', (tester) async {
    await _pump(
      tester,
      scenario: _scenario(triggerWarnings: ['Self-harm', 'Grief']),
      onStart: (_) async {},
    );

    expect(find.textContaining('Trigger warnings'), findsOneWidget);
    expect(find.text('Self-harm'), findsOneWidget);
    expect(find.text('Grief'), findsOneWidget);
  });

  testWidgets('no language picker when the scenario has none', (tester) async {
    await _pump(tester, scenario: _scenario(), onStart: (_) async {});

    expect(find.byKey(const Key('simulation-details-modal-language')), findsNothing);
  });

  testWidgets(
    'a language picker defaults to the first option and passes the chosen languageId on start',
    (tester) async {
      int? captured;
      await _pump(
        tester,
        scenario: _scenario(
          availableLanguages: [
            {'language_id': 1, 'label': 'English', 'active': true},
            {'language_id': 2, 'label': 'Hindi', 'active': true},
          ],
        ),
        onStart: (languageId) async => captured = languageId,
      );

      expect(find.text('English'), findsOneWidget);

      await tester.tap(find.byKey(const Key('simulation-details-modal-language')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Hindi').last);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('simulation-details-modal-start')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Start Session'));
      await tester.pumpAndSettle();

      expect(captured, 2);
    },
  );

  testWidgets('a scenario with no languages starts with a null languageId', (tester) async {
    int? captured = -1;
    await _pump(tester, scenario: _scenario(), onStart: (languageId) async => captured = languageId);

    await tester.tap(find.byKey(const Key('simulation-details-modal-start')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Start Session'));
    await tester.pumpAndSettle();

    expect(captured, isNull);
  });

  testWidgets('the close button pops without calling onStart', (tester) async {
    var startCalls = 0;
    await _pump(tester, scenario: _scenario(), onStart: (_) async => startCalls++);

    await tester.tap(find.byKey(const Key('simulation-details-modal-close')));
    await tester.pumpAndSettle();

    expect(startCalls, 0);
    expect(find.byKey(const Key('simulation-details-modal-start')), findsNothing);
  });

  testWidgets('Start first shows RN\'s pre-start confirmation, hiding this modal; '
      'closing it brings this modal back without starting', (tester) async {
    var startCalls = 0;
    await _pump(tester, scenario: _scenario(), onStart: (_) async => startCalls++);

    await tester.tap(find.byKey(const Key('simulation-details-modal-start')));
    await tester.pumpAndSettle();

    expect(find.text('Before you get started'), findsOneWidget);
    expect(find.byKey(const Key('simulation-details-modal-start')), findsNothing, reason: 'hidden while confirming');

    await tester.tap(find.byKey(const Key('pre-start-modal-close')));
    await tester.pumpAndSettle();

    expect(startCalls, 0);
    expect(find.byKey(const Key('simulation-details-modal-start')), findsOneWidget);
  });

  testWidgets('a start failure still closes the modal (RN\'s finally)', (tester) async {
    await _pump(
      tester,
      scenario: _scenario(),
      onStart: (_) async => throw Exception('boom'),
    );

    await tester.tap(find.byKey(const Key('simulation-details-modal-start')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Start Session'));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('simulation-details-modal-start')), findsNothing);
  });

  testWidgets('a successful start closes the modal', (tester) async {
    await _pump(tester, scenario: _scenario(), onStart: (_) async {});

    await tester.tap(find.byKey(const Key('simulation-details-modal-start')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Start Session'));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('simulation-details-modal-start')), findsNothing);
  });
}
