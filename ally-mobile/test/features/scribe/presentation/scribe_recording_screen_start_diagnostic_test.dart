import 'dart:typed_data';

import 'package:flutter_foreground_task/flutter_foreground_task_platform_interface.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:permission_handler_platform_interface/permission_handler_platform_interface.dart';
import 'package:record_platform_interface/record_platform_interface.dart';

import 'package:ally_mobile_flutter/core/app_update/force_update.dart';
import 'package:ally_mobile_flutter/core/realtime/socket_events.dart';
import 'package:ally_mobile_flutter/core/realtime/socket_service.dart';
import 'package:ally_mobile_flutter/features/scribe/presentation/scribe_recording_screen.dart';

import '../../../support/fake_foreground_task_platform.dart';
import '../../../support/fake_permission_platform.dart';
import '../../../support/mock_record_platform.dart';
import '../../../support/pump_app.dart';

class MockSocketService extends Mock implements SocketService {}

// One `testWidgets` per file — see scribe_recording_screen_initial_state_test.dart.
void main() {
  setUpAll(() {
    registerFallbackValue(const RecordConfig());
  });

  testWidgets('a session that never starts reports SCRIBE_START_DIAGNOSTIC at 5s and 15s (RN)', (tester) async {
    PermissionHandlerPlatform.instance = FakePermissionHandlerPlatform({
      Permission.microphone: PermissionStatus.granted,
      Permission.notification: PermissionStatus.granted,
    });
    FlutterForegroundTaskPlatform.instance = FakeForegroundTaskPlatform();
    final recordPlatform = installMockRecordPlatform();
    when(() => recordPlatform.startStream(any(), any())).thenAnswer((_) async => const Stream<Uint8List>.empty());
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
    final diagnostics = <Map<String, dynamic>>[];
    when(() => socketService.emit(any(), any())).thenAnswer((invocation) {
      if (invocation.positionalArguments[0] == SocketEvent.scribeStartDiagnostic) {
        diagnostics.add(Map<String, dynamic>.from(invocation.positionalArguments[1] as Map));
      }
    });

    await pumpApp(
      tester,
      const ScribeRecordingScreen(userId: 'user-1'),
      overrides: [
        socketServiceProvider.overrideWithValue(socketService),
        appVersionProvider.overrideWith((ref) async => '9.9.9'),
      ],
    );
    await tester.pump(const Duration(seconds: 16));
    await tester.pump();

    expect(diagnostics.map((d) => d['afterMs']), [5000, 15000]);
    expect(diagnostics.first, {
      'afterMs': 5000,
      'appVersion': '9.9.9',
      'isPermissionGranted': true,
      'permissionStatus': 'granted',
      'isMicrophoneModeSessionCreated': false,
      'isWebMicrophoneMode': false,
      'isAudioChatEmitted': false,
      'hasChatId': false,
      'isOffline': false,
    });
  });
}
