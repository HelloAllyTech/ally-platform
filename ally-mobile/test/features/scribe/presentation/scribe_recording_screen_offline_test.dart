import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/widgets.dart';
import 'package:flutter_foreground_task/flutter_foreground_task_platform_interface.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:permission_handler_platform_interface/permission_handler_platform_interface.dart';
import 'package:record_platform_interface/record_platform_interface.dart';

import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/realtime/connectivity.dart';
import 'package:ally_mobile_flutter/core/realtime/socket_events.dart';
import 'package:ally_mobile_flutter/core/realtime/socket_service.dart';
import 'package:ally_mobile_flutter/features/scribe/data/chat_repository.dart';
import 'package:ally_mobile_flutter/features/scribe/presentation/scribe_recording_screen.dart';

import '../../../support/fake_foreground_task_platform.dart';
import '../../../support/fake_permission_platform.dart';
import '../../../support/mock_record_platform.dart';
import '../../../support/pump_app.dart';

class MockSocketService extends Mock implements SocketService {}

class MockChatRepository extends Mock implements ChatRepository {}

// One `testWidgets` per file — see
// scribe_recording_screen_initial_state_test.dart for why.
void main() {
  setUpAll(() {
    registerFallbackValue(const RecordConfig());
  });

  testWidgets('offline (connectivity) shows the NETWORK view with no Try again', (tester) async {
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
    void Function(String? reason)? onDisconnect;
    when(
      () => socketService.connect(
        namespacePath: any(named: 'namespacePath'),
        userId: any(named: 'userId'),
        eventCallbacks: any(named: 'eventCallbacks'),
        onConnect: any(named: 'onConnect'),
        onDisconnect: any(named: 'onDisconnect'),
        onConnectionError: any(named: 'onConnectionError'),
      ),
    ).thenAnswer((invocation) async {
      final callbacks = invocation.namedArguments[#eventCallbacks] as Map<String, void Function(dynamic data)>;
      onDisconnect = invocation.namedArguments[#onDisconnect] as void Function(String? reason)?;
      callbacks[SocketEvent.userJoined]!({'payload': {'chatId': 99}});
    });
    when(() => socketService.disconnect()).thenAnswer((_) {});
    when(() => socketService.emit(any(), any())).thenAnswer((_) {});
    final chatRepository = MockChatRepository();
    // The hydrating GET finds nothing yet (the race RN fixed).
    when(() => chatRepository.getCounsellorChat()).thenAnswer((_) async => null);

    await pumpApp(
      tester,
      const ScribeRecordingScreen(userId: '7'),
      overrides: [
        socketServiceProvider.overrideWithValue(socketService),
        chatRepositoryProvider.overrideWithValue(chatRepository),
        userPermissionsProvider.overrideWith((ref) async => <String>[]),
        isOfflineProvider.overrideWith((ref) => Stream.value(true)),
      ],
    );

    await tester.pump();
    expect(find.byKey(const ValueKey('network-disconnected')), findsOneWidget);
    expect(find.text('No internet connection'), findsOneWidget);
    expect(find.byKey(const ValueKey('disconnected-try-again')), findsNothing);
    expect(find.byKey(const ValueKey('disconnected-go-back')), findsOneWidget);
    // Avoid an unused-variable lint on the captured callback.
    expect(onDisconnect, isNotNull);
  });
}
