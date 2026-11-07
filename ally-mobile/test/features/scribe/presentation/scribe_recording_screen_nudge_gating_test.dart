import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/widgets.dart';
import 'package:flutter_foreground_task/flutter_foreground_task_platform_interface.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:permission_handler_platform_interface/permission_handler_platform_interface.dart';
import 'package:record_platform_interface/record_platform_interface.dart';

import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';
import 'package:ally_mobile_flutter/core/realtime/socket_events.dart';
import 'package:ally_mobile_flutter/core/realtime/socket_service.dart';
import 'package:ally_mobile_flutter/core/settings/settings_repository.dart';
import 'package:ally_mobile_flutter/features/scribe/data/chat_models.dart';
import 'package:ally_mobile_flutter/features/scribe/data/chat_repository.dart';
import 'package:ally_mobile_flutter/features/scribe/presentation/scribe_recording_screen.dart';

import '../../../support/fake_foreground_task_platform.dart';
import '../../../support/fake_permission_platform.dart';
import '../../../support/mock_record_platform.dart';
import '../../../support/pump_app.dart';

class MockSocketService extends Mock implements SocketService {}

class MockChatRepository extends Mock implements ChatRepository {}

// Own file, not a second `testWidgets` in scribe_recording_screen_connected_test.dart
// — see scribe_recording_screen_initial_state_test.dart's "one testWidgets per file" note.
void main() {
  setUpAll(() {
    registerFallbackValue(const RecordConfig());
  });

  testWidgets(
    "a tenant with nudges disabled never shows the nudge section, even once a NUDGE event "
    "arrives — mirrors RN's `!!nudgeStatus && currentNudge` render gate in "
    'MicrophoneListeningScreen.tsx',
    (tester) async {
      PermissionHandlerPlatform.instance = FakePermissionHandlerPlatform({
        Permission.microphone: PermissionStatus.granted,
        Permission.notification: PermissionStatus.granted,
      });
      FlutterForegroundTaskPlatform.instance = FakeForegroundTaskPlatform();
      final recordPlatform = installMockRecordPlatform();
      final chunkController = StreamController<Uint8List>();
      when(
        () => recordPlatform.startStream(any(), any()),
      ).thenAnswer((_) async => chunkController.stream);
      when(() => recordPlatform.onStateChanged(any())).thenAnswer((_) => const Stream.empty());
      when(() => recordPlatform.stop(any())).thenAnswer((_) async => null);

      final socketService = MockSocketService();
      late Map<String, void Function(dynamic data)> callbacks;
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
        callbacks =
            invocation.namedArguments[#eventCallbacks] as Map<String, void Function(dynamic data)>;
        callbacks[SocketEvent.userJoined]!(null);
      });
      when(() => socketService.disconnect()).thenAnswer((_) {});
      when(() => socketService.emit(any(), any())).thenAnswer((_) {});

      final chatRepository = MockChatRepository();
      when(() => chatRepository.getCounsellorChat()).thenAnswer(
        (_) async => Chat(
          chatId: 42,
          status: ChatStatus.active,
          provider: ChatProvider.microphone,
          startedAt: '2026-01-01T10:00:00.000Z',
        ),
      );

      await pumpApp(
        tester,
        const ScribeRecordingScreen(userId: '7'),
        overrides: [
          socketServiceProvider.overrideWithValue(socketService),
          chatRepositoryProvider.overrideWithValue(chatRepository),
          userPermissionsProvider.overrideWith(
            (ref) async => [UserPermissions.viewReferenceDocument],
          ),
          nudgeStatusProvider.overrideWith((ref) async => false),
        ],
      );

      // Starts in focus mode (matching RN), which hides the nudge area too —
      // leave it so the nudge section would render if it were going to.
      await tester.tap(find.byKey(const ValueKey('focus-mode-button')));
      await tester.pumpAndSettle();

      callbacks[SocketEvent.nudge]!({
        'payload': {
          'id': 5,
          'content': 'Try an open question.',
          'chatId': 42,
          'senderId': 2,
          'createdAt': '2026-01-01T10:00:05.000Z',
        },
      });
      await tester.pump(const Duration(milliseconds: 600));

      expect(find.text('Try an open question.'), findsNothing);

      await chunkController.close();
    },
  );
}
