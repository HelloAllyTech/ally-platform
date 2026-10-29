import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/roleplay/presentation/session_info_tabs.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulation_models.dart';

import '../../../support/pump_app.dart';

// One `testWidgets` per file — see
// roleplay_voice_screen_initial_state_test.dart for why this feature's
// screen/widget tests are one-pump-per-file.
void main() {
  testWidgets(
    'only tabs with content render, defaults to Reminders when there is no checklist, and '
    'tapping Description switches the shown content',
    (tester) async {
      final scenario = Scenario(
        id: 1,
        title: 'Test',
        description: 'A hard conversation.',
        coverImageUrl: null,
        reminders: const ['Ask about their day'],
      );

      // `InkWell` (the tab buttons) needs a `Material` ancestor — real
      // callers always embed this inside a `Scaffold`, which `pumpApp`'s
      // bare `MaterialApp(home: child)` doesn't provide on its own (same
      // gotcha as `ListeningControls`'s own test).
      await pumpApp(
        tester,
        Scaffold(body: SessionInfoTabs(scenario: scenario, triggeredEventIds: const {})),
      );

      expect(find.byKey(const ValueKey('session-info-tab-checklist')), findsNothing);
      expect(find.byKey(const ValueKey('session-info-tab-reminders')), findsOneWidget);
      expect(find.byKey(const ValueKey('session-info-tab-description')), findsOneWidget);
      expect(find.text('Ask about their day'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('session-info-tab-description')));
      await tester.pumpAndSettle();

      // `HtmlRichText` renders via Flutter's `RichText`, not a plain `Text`
      // widget — `find.text()` needs `findRichText: true` to see inside it.
      expect(find.text('A hard conversation.', findRichText: true), findsOneWidget);
      expect(find.text('Ask about their day'), findsNothing);
    },
  );
}
