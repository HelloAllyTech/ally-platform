import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/roleplay/presentation/session_goal_timer.dart';
import 'package:ally_mobile_flutter/features/roleplay/presentation/session_progress.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulation_models.dart';

import '../../../support/pump_app.dart';

void main() {
  test('currentStateIndex follows RN DIFFICULTY_STATE_SCORE_MAP', () {
    expect(currentStateIndex(-60, 'EASY'), 0);
    expect(currentStateIndex(-50, 'EASY'), 1);
    expect(currentStateIndex(20, 'EASY'), 2);
    expect(currentStateIndex(70, 'EASY'), 3);
    expect(currentStateIndex(49, 'MEDIUM'), 1);
    expect(currentStateIndex(150, 'HARD'), 2);
    expect(currentStateIndex(500, null), 0);
  });

  test('parseGoalTimeValue reads HH:MM:SS', () {
    expect(parseGoalTimeValue('00:10:00'), 600);
    expect(parseGoalTimeValue('01:00:05'), 3605);
    expect(parseGoalTimeValue(null), 0);
  });

  testWidgets(
    'SessionGoalTimer shows the total and the remaining time; SessionProgress lists the states',
    (tester) async {
      final elapsed = ValueNotifier(const Duration(seconds: 125));
      await pumpApp(
        tester,
        Scaffold(
          body: Column(
            children: [
              SessionGoalTimer(maxTimeValue: '00:10:00', elapsed: elapsed),
              const SessionProgress(
                stateNames: [
                  StateInstruction(stateId: '1', name: 'Defensive'),
                  StateInstruction(stateId: '2', name: 'Cautious'),
                  StateInstruction(stateId: '3', name: 'Open'),
                ],
                difficultyLevel: 'EASY',
                score: 30,
              ),
            ],
          ),
        ),
      );

      expect(find.text('Session Timer'), findsOneWidget);
      expect(find.text('Time Remaining'), findsOneWidget);
      expect(find.text('10:00'), findsOneWidget);
      expect(find.text('7 min 55 sec'), findsOneWidget);

      elapsed.value = const Duration(minutes: 11);
      await tester.pump();
      expect(find.text('0 min 0 sec'), findsOneWidget);

      expect(find.text('Defensive'), findsOneWidget);
      expect(find.text('Open'), findsOneWidget);
      // Score 30 on EASY is state index 2 → its dot is the larger active one.
      expect(
        tester
            .getSize(find.byKey(const ValueKey('session-progress-dot-3')))
            .width,
        14,
      );
      expect(
        tester
            .getSize(find.byKey(const ValueKey('session-progress-dot-1')))
            .width,
        10,
      );
    },
  );
}
