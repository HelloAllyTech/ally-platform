import 'dart:typed_data';

import 'package:flutter_foreground_task/flutter_foreground_task_platform_interface.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:permission_handler_platform_interface/permission_handler_platform_interface.dart';
import 'package:record_platform_interface/record_platform_interface.dart';

import 'package:ally_mobile_flutter/core/realtime/socket_service.dart';
import 'package:ally_mobile_flutter/features/scribe/presentation/scribe_recording_screen.dart';

import '../../../support/fake_foreground_task_platform.dart';
import '../../../support/fake_permission_platform.dart';
import '../../../support/mock_record_platform.dart';
import '../../../support/pump_app.dart';

class MockSocketService extends Mock implements SocketService {}

// One `testWidgets` per file — a second real `pumpApp()` in the same file
// reliably stalls translation loading (documented across this repo's other
// screen tests, e.g. roleplay_voice_screen's own test files).
void main() {
  setUpAll(() {
    registerFallbackValue(const RecordConfig());
  });

  testWidgets(
    'auto-starts on mount (no Start button, matching RN), and the 5s chat-id timeout '
    'shows Microphone failure when no USER_JOINED ever arrives',
    (tester) async {
      PermissionHandlerPlatform.instance = FakePermissionHandlerPlatform({
        Permission.microphone: PermissionStatus.granted,
        Permission.notification: PermissionStatus.granted,
      });
      FlutterForegroundTaskPlatform.instance = FakeForegroundTaskPlatform();
      final recordPlatform = installMockRecordPlatform();
      when(
        () => recordPlatform.startStream(any(), any()),
      ).thenAnswer((_) async => const Stream<Uint8List>.empty());
      when(() => recordPlatform.onStateChanged(any())).thenAnswer((_) => const Stream.empty());
      when(() => recordPlatform.stop(any())).thenAnswer((_) async => null);
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
      when(() => socketService.emit(any(), any())).thenAnswer((_) {});

      await pumpApp(
        tester,
        const ScribeRecordingScreen(userId: 'user-1'),
        overrides: [socketServiceProvider.overrideWithValue(socketService)],
      );

      // No `USER_JOINED` was ever simulated, so the screen never learns a
      // chat id. `pumpApp`'s own `pumpAndSettle()` advances this test's fake
      // clock well past the 5s chat-id timeout on its own (confirmed
      // empirically — a bare `tester.pump()` right after `pumpWidget` would
      // still show the transient "Connecting..." state instead), landing on
      // the real, fully-settled outcome: `DisconnectedType.microphoneFailure`.
      expect(find.text('Microphone failure'), findsOneWidget);
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
    },
  );
}
