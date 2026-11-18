import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/scribe/presentation/network_disconnected.dart';

import '../../../support/pump_app.dart';

// One `testWidgets` per file — see network_disconnected_socket_test.dart.
void main() {
  testWidgets('MICROPHONE_FAILURE type shows microphone-failure copy', (tester) async {
    await pumpApp(
      tester,
      NetworkDisconnected(
        type: DisconnectedType.microphoneFailure,
        isOffline: false,
        onTryAgain: () {},
        onGoBack: () {},
      ),
    );

    expect(find.text('Microphone failure'), findsOneWidget);
  });
}
