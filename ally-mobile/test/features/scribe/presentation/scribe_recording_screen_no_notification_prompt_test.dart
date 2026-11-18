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

/// Records every permission the screen asks the OS for.
class _RecordingPermissionPlatform extends FakePermissionHandlerPlatform {
  _RecordingPermissionPlatform() : super({Permission.microphone: PermissionStatus.granted});

  final requested = <Permission>[];

  @override
  Future<Map<Permission, PermissionStatus>> requestPermissions(List<Permission> permissions) {
    requested.addAll(permissions);
    return super.requestPermissions(permissions);
  }
}

// One `testWidgets` per file — see scribe_recording_screen_initial_state_test.dart.
// RN's Scribe start never asks for notification permission.
void main() {
  setUpAll(() {
    registerFallbackValue(const RecordConfig());
  });

  testWidgets('starting Scribe records without requesting notification permission (RN)', (tester) async {
    final permissions = _RecordingPermissionPlatform();
    PermissionHandlerPlatform.instance = permissions;
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
    when(() => socketService.emit(any(), any())).thenAnswer((_) {});

    await pumpApp(
      tester,
      const ScribeRecordingScreen(userId: 'user-1'),
      overrides: [socketServiceProvider.overrideWithValue(socketService)],
    );
    await tester.pump(const Duration(milliseconds: 100));

    verify(() => recordPlatform.startStream(any(), any())).called(1);
    expect(permissions.requested, isNot(contains(Permission.notification)));
    // Let the 5s/15s start-diagnostic timers fire so none is left pending.
    await tester.pump(const Duration(seconds: 16));
  });
}
