import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/scribe/presentation/listening_controls.dart';

import '../../../support/pump_app.dart';

// One `testWidgets` per file — see
// network_disconnected_socket_test.dart for why.
void main() {
  testWidgets(
    'shows Pause/Resume, End session, and the mute tooltip (dismissable) when paused',
    (tester) async {
      var toggledPauseResume = false;
      var endedSession = false;
      var dismissedTooltip = false;

      await pumpApp(
        tester,
        // `ListeningControls` is a sub-component, always embedded inside a
        // real screen's own `Scaffold` — wrapped here too, since without
        // one `MaterialApp.home`'s direct child lays out differently (this
        // Row genuinely overflows test-harness-only, confirmed by
        // reproducing it both with and without a `Scaffold` ancestor).
        Scaffold(
          body: ListeningControls(
            isCallPaused: true,
            onPauseResumePress: () => toggledPauseResume = true,
            onCallEndPress: () => endedSession = true,
            showMuteTooltip: true,
            onDismissMuteTooltip: () => dismissedTooltip = true,
          ),
        ),
      );

      expect(find.text('Resume note taking'), findsOneWidget);
      expect(find.text('End Session'), findsOneWidget);
      expect(find.text('Your data is safe'), findsOneWidget);
      expect(find.byKey(const ValueKey('mute-tooltip')), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('pause-resume-button')));
      await tester.pump();
      expect(toggledPauseResume, isTrue);

      await tester.tap(find.byKey(const ValueKey('end-session-button')));
      await tester.pump();
      expect(endedSession, isTrue);

      await tester.tap(find.byIcon(Icons.close));
      await tester.pump();
      expect(dismissedTooltip, isTrue);
    },
  );
}
