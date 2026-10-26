import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/roleplay/presentation/participant_tile.dart';
import 'package:ally_mobile_flutter/features/roleplay/presentation/turn_state.dart';

import '../../../support/pump_app.dart';

// One `testWidgets` per file — see
// session_info_tabs_switching_test.dart for why.
void main() {
  testWidgets(
    'shows the speaking border + pulse when speaking, and the turn-state label pill',
    (tester) async {
      await pumpApp(
        tester,
        const Scaffold(
          body: ParticipantTile(
            avatarUrl: null,
            isSpeaking: true,
            turnState: TurnState.aiSpeaking,
          ),
        ),
      );

      expect(find.text('Speaking...'), findsOneWidget);
      expect(find.byKey(const ValueKey('speaking-indicator')), findsOneWidget);
      expect(find.byIcon(Icons.person), findsOneWidget);
    },
  );
}
