import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/scribe/presentation/scribe_recording_screen.dart';

import '../../../support/mock_record_platform.dart';
import '../../../support/pump_app.dart';

// One `testWidgets` per file across this screen's test files, deliberately
// — see roleplay_voice_screen_initial_state_test.dart for the full
// explanation (a second full `pumpApp()` of a translation-dependent screen
// within the same isolate was found to reliably stall).
void main() {
  testWidgets('shows the not-recording state with a Start recording button', (tester) async {
    installMockRecordPlatform();

    await pumpApp(tester, const ScribeRecordingScreen(userId: 'user-1'));

    expect(find.text('Not recording'), findsOneWidget);
    expect(find.text('Start recording'), findsOneWidget);
    expect(find.textContaining('disconnected'), findsOneWidget);
  });
}
