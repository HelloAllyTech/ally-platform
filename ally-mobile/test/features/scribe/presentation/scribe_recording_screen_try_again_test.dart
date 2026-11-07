import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/widgets.dart';
import 'package:flutter_foreground_task/flutter_foreground_task_platform_interface.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:permission_handler_platform_interface/permission_handler_platform_interface.dart';
import 'package:record_platform_interface/record_platform_interface.dart';

import 'package:ally_mobile_flutter/core/realtime/connectivity.dart';
import 'package:ally_mobile_flutter/core/realtime/socket_events.dart';
import 'package:ally_mobile_flutter/core/realtime/socket_service.dart';
import 'package:ally_mobile_flutter/features/scribe/data/chat_models.dart';
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

  testWidgets(
    'Try again reconnects in place on a mid-session drop: the error screen '
    'clears, the socket reconnects, and the reconnect re-checks the chat '
    'rather than leaving via handleGoBack',
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
      var connectCount = 0;
      late Map<String, void Function(dynamic data)> callbacks;
      void Function(String? reason)? onDisconnect;
      void Function()? onConnect;
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
        connectCount++;
        callbacks =
            invocation.namedArguments[#eventCallbacks] as Map<String, void Function(dynamic data)>;
        onDisconnect = invocation.namedArguments[#onDisconnect] as void Function(String?)?;
        onConnect = invocation.namedArguments[#onConnect] as void Function()?;
        // Only the first connect yields USER_JOINED — a reconnect should
        // resume the same chat, not need a second one.
        if (connectCount == 1) callbacks[SocketEvent.userJoined]!(null);
      });
      when(() => socketService.disconnect()).thenAnswer((_) {});
      when(() => socketService.emit(any(), any())).thenAnswer((_) {});

      final chatRepository = MockChatRepository();
      var getChatCalls = 0;
      when(() => chatRepository.getCounsellorChat()).thenAnswer((_) async {
        getChatCalls++;
        return Chat(
          chatId: 42,
          status: ChatStatus.active,
          provider: ChatProvider.microphone,
          startedAt: '2026-01-01T10:00:00.000Z',
          messages: const [],
        );
      });

      await pumpApp(
        tester,
        const ScribeRecordingScreen(userId: '7'),
        overrides: [
          socketServiceProvider.overrideWithValue(socketService),
          chatRepositoryProvider.overrideWithValue(chatRepository),
          isOfflineProvider.overrideWith((ref) => Stream.value(false)),
        ],
      );

      expect(find.byKey(const ValueKey('audio-waveform-container')), findsOneWidget);
      expect(connectCount, 1);
      final getChatCallsBeforeDrop = getChatCalls;

      // A transient drop mid-session — USER_JOINED already gave this a
      // chatId, so this isn't the "never started" case.
      onDisconnect?.call('transport close');
      await tester.pumpAndSettle();
      expect(find.text('Something went wrong!'), findsOneWidget);

      await tester.tap(find.text('Try again'));
      await tester.pump();

      // Reconnected right here — not a round trip through handleGoBack: the
      // error screen is gone and the live session is straight back, with a
      // second connect() for the same chat.
      expect(find.text('Something went wrong!'), findsNothing);
      expect(find.byKey(const ValueKey('audio-waveform-container')), findsOneWidget);
      expect(connectCount, 2);

      // The reconnect's own onConnect re-validates the chat is still alive —
      // the same staleness check foregrounding runs — instead of silently
      // resuming one the gap may have already ended.
      onConnect?.call();
      await tester.pumpAndSettle();
      expect(getChatCalls, greaterThan(getChatCallsBeforeDrop));
    },
  );
}
