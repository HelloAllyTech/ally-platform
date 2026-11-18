import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/scribe/presentation/network_disconnected.dart';

import '../../../support/pump_app.dart';

// One `testWidgets` per file — a second real `pumpApp()` in the same file
// reliably stalls translation loading (documented across this repo's other
// screen tests, e.g. roleplay_voice_screen's/scribe_recording_screen's own
// test files).
void main() {
  testWidgets('SOCKET type shows the generic error copy, Try again, and Go back', (tester) async {
    var triedAgain = false;
    var wentBack = false;

    await pumpApp(
      tester,
      NetworkDisconnected(
        type: DisconnectedType.socket,
        isOffline: false,
        onTryAgain: () => triedAgain = true,
        onGoBack: () => wentBack = true,
      ),
    );

    // RN: the SOCKET title is the generic common.somethingWentWrong.
    expect(find.text('Something went wrong!'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);

    await tester.tap(find.text('Try again'));
    await tester.pump();
    expect(triedAgain, isTrue);

    await tester.tap(find.text('Go back'));
    await tester.pump();
    expect(wentBack, isTrue);
  });
}
