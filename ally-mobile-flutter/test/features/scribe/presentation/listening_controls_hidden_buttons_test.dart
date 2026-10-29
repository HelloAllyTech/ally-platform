import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/scribe/presentation/listening_controls.dart';

import '../../../support/pump_app.dart';

// One `testWidgets` per file — see
// network_disconnected_socket_test.dart for why.
void main() {
  testWidgets(
    'hides Pause/Resume and End session when both are set false (ConferenceListeningScreen\'s '
    'real configuration), while the focus-mode button and data-safe note still show',
    (tester) async {
      await pumpApp(
        tester,
        Scaffold(
          body: ListeningControls(
            isCallPaused: false,
            onPauseResumePress: () {},
            onCallEndPress: () {},
            showPauseResumeButton: false,
            showEndSessionButton: false,
            showFocusModeButton: true,
            onFocusModeButtonPress: () {},
          ),
        ),
      );

      expect(find.byKey(const ValueKey('pause-resume-button')), findsNothing);
      expect(find.byKey(const ValueKey('end-session-button')), findsNothing);
      expect(find.byKey(const ValueKey('focus-mode-button')), findsOneWidget);
      expect(find.text('Your data is safe'), findsOneWidget);
    },
  );
}
