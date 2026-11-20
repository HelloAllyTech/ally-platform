import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/roleplay/presentation/session_info_tabs.dart';
import 'package:ally_mobile_flutter/features/simulations/data/learner_debrief_repository.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulation_models.dart';

import '../../../support/pump_app.dart';

// One `testWidgets` per file (see session_info_tabs_switching_test.dart).
void main() {
  testWidgets(
    'the learner\'s last debrief points join the Reminders tab, even for a roleplay with no reminders of its own',
    (tester) async {
      final scenario = Scenario(id: 7, title: 'Test', description: null, coverImageUrl: null);
      expect(SessionInfoTabs.hasAnyTab(scenario), isFalse);
      expect(SessionInfoTabs.hasAnyTab(scenario, hasDebriefPoints: true), isTrue);

      const points = LatestDebriefPoints(
        workOnThis: [(lead: 'Slow down after a big feeling.', trySaying: 'That sounds really heavy.')],
        practiseNext: (skill: 'Asking about safety', reason: 'It did not come up this time.'),
      );
      await pumpApp(
        tester,
        Scaffold(
          body: SessionInfoTabs(scenario: scenario, triggeredEventIds: const {}),
        ),
        overrides: [latestDebriefPointsProvider.overrideWith((ref, id) async => id == 7 ? points : null)],
      );
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('session-info-tab-reminders')), findsOneWidget);
      expect(find.text('From your last debrief'), findsOneWidget);
      expect(find.text('What to strengthen'), findsOneWidget);
      expect(find.text('Slow down after a big feeling.'), findsOneWidget);
      expect(find.textContaining('That sounds really heavy.'), findsOneWidget);
      expect(find.text('Try this in your next practice'), findsOneWidget);
      expect(find.text('Asking about safety'), findsOneWidget);
    },
  );
}
