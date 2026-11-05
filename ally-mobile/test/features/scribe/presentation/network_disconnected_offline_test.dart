import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/scribe/presentation/network_disconnected.dart';

import '../../../support/pump_app.dart';

// One `testWidgets` per file — see network_disconnected_socket_test.dart.
void main() {
  testWidgets('hides Try again while offline — retrying is pointless with no network', (
    tester,
  ) async {
    await pumpApp(
      tester,
      NetworkDisconnected(
        type: DisconnectedType.network,
        isOffline: true,
        onTryAgain: () {},
        onGoBack: () {},
      ),
    );

    expect(find.text('Try again'), findsNothing);
    expect(find.text('Go back'), findsOneWidget);
  });
}
