import 'package:flutter/cupertino.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:permission_handler_platform_interface/permission_handler_platform_interface.dart';

import 'package:ally_mobile_flutter/core/realtime/socket_service.dart';
import 'package:ally_mobile_flutter/features/scribe/presentation/scribe_recording_screen.dart';

import '../../../support/fake_permission_platform.dart';
import '../../../support/mock_record_platform.dart';
import '../../../support/pump_app.dart';

class MockSocketService extends Mock implements SocketService {}

// See scribe_recording_screen_initial_state_test.dart (and, for the full
// explanation, roleplay_voice_screen_initial_state_test.dart) for why this
// screen's tests are one-`testWidgets`-per-file.
void main() {
  testWidgets('a refused mic shows RN\'s "Allow microphone" settings alert; the socket still connects', (
    tester,
  ) async {
    installMockRecordPlatform();
    PermissionHandlerPlatform.instance = FakePermissionHandlerPlatform({
      Permission.microphone: PermissionStatus.denied,
    });
    final socketService = MockSocketService();
    when(
      () => socketService.connect(
        namespacePath: any(named: 'namespacePath'),
        userId: any(named: 'userId'),
        eventCallbacks: any(named: 'eventCallbacks'),
        onConnect: any(named: 'onConnect'),
        onDisconnect: any(named: 'onDisconnect'),
        onConnectionError: any(named: 'onConnectionError'),
      ),
    ).thenAnswer((_) async {});
    when(() => socketService.disconnect()).thenAnswer((_) {});

    await pumpApp(
      tester,
      const ScribeRecordingScreen(userId: 'user-1'),
      overrides: [socketServiceProvider.overrideWithValue(socketService)],
    );

    // RN useLiveAudioStream: refusal → Alert (Cancel goes back / OK opens
    // Settings). RN's socket connects independently of the microphone.
    expect(find.byType(CupertinoAlertDialog), findsOneWidget);
    // (Its copy is resolved when it opens, which in this harness can be
    // before the bundled translations finish loading.)
    verify(
      () => socketService.connect(
        namespacePath: '/microphone-chat',
        userId: 'user-1',
        eventCallbacks: any(named: 'eventCallbacks'),
        onConnect: any(named: 'onConnect'),
        onDisconnect: any(named: 'onDisconnect'),
        onConnectionError: any(named: 'onConnectionError'),
      ),
    ).called(1);
    verifyNever(() => socketService.emit(any(), any()));
  });
}
