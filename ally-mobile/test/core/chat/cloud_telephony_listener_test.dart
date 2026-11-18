import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/chat/cloud_telephony_listener.dart';
import 'package:ally_mobile_flutter/core/config/app_config.dart';
import 'package:ally_mobile_flutter/core/realtime/socket_events.dart';
import 'package:ally_mobile_flutter/core/realtime/socket_service.dart';

class _MockSocketService extends Mock implements SocketService {}

// RN RootNavigator: an app-wide socket on CLOUD_TELEPHONY_PATH whose
// USER_JOINED runs the active-chat check; dropped in the background and
// reconnected in the foreground (useSocketConnection's default).
void main() {
  test('connects on start, routes USER_JOINED, follows the app lifecycle, and stops', () async {
    final socket = _MockSocketService();
    Map<String, void Function(dynamic)>? callbacks;
    when(
      () => socket.connect(
        namespacePath: any(named: 'namespacePath'),
        userId: any(named: 'userId'),
        eventCallbacks: any(named: 'eventCallbacks'),
        onConnect: any(named: 'onConnect'),
        onDisconnect: any(named: 'onDisconnect'),
        onConnectionError: any(named: 'onConnectionError'),
      ),
    ).thenAnswer((invocation) async {
      callbacks = invocation.namedArguments[#eventCallbacks] as Map<String, void Function(dynamic)>;
    });
    when(() => socket.disconnect()).thenAnswer((_) {});

    var checks = 0;
    final listener = CloudTelephonyListener(socket);
    await listener.start(userId: '7', onUserJoined: () => checks++);

    verify(
      () => socket.connect(
        namespacePath: AppConfig.cloudTelephonyPath,
        userId: '7',
        eventCallbacks: any(named: 'eventCallbacks'),
      ),
    ).called(1);

    callbacks![SocketEvent.userJoined]!({'payload': {'chatId': 5}});
    expect(checks, 1);

    await listener.onLifecycle(AppLifecycleState.paused);
    verify(() => socket.disconnect()).called(1);
    await listener.onLifecycle(AppLifecycleState.resumed);
    verify(
      () => socket.connect(
        namespacePath: AppConfig.cloudTelephonyPath,
        userId: '7',
        eventCallbacks: any(named: 'eventCallbacks'),
      ),
    ).called(1);

    listener.stop();
    verify(() => socket.disconnect()).called(1);
    await listener.onLifecycle(AppLifecycleState.resumed);
    verifyNever(
      () => socket.connect(
        namespacePath: any(named: 'namespacePath'),
        userId: any(named: 'userId'),
        eventCallbacks: any(named: 'eventCallbacks'),
      ),
    );
  });
}
