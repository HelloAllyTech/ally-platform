import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/scribe/presentation/network_disconnected.dart';

import '../../../support/pump_app.dart';

// One `testWidgets` per file — see network_disconnected_socket_test.dart.
void main() {
  testWidgets('NETWORK type shows network-specific copy', (tester) async {
    await pumpApp(
      tester,
      NetworkDisconnected(
        type: DisconnectedType.network,
        isOffline: false,
        onTryAgain: () {},
        onGoBack: () {},
      ),
    );

    expect(find.text('No internet connection'), findsOneWidget);
  });
}
