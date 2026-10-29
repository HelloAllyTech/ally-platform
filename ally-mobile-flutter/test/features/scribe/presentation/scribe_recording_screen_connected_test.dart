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
    'USER_JOINED hydrates the chat (timer/transcript), pause toggles audio emission, '
    'and End Session calls endCall and disconnects',
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
        // Fired here, synchronously as part of the simulated connect, not
        // after `pumpApp` returns — `pumpApp`'s own `pumpAndSettle()`
        // advances this test's fake clock well past the 5s chat-id
        // timeout on its own (confirmed in
        // scribe_recording_screen_initial_state_test.dart), so waiting
        // until after `pumpApp` to simulate USER_JOINED would always lose
        // that race in this harness, unlike the real (non-test) app.
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
          messages: [
            ChatMessage(
              id: 1,
              chatId: 42,
              senderId: 7,
              type: MessageType.text,
              content: 'Hello, how can I help today?',
              createdAt: '2026-01-01T10:00:05.000Z',
            ),
          ],
        ),
      );
      when(() => chatRepository.endCall(42)).thenAnswer((_) async {});

      await pumpApp(
        tester,
        const ScribeRecordingScreen(userId: '7'),
        overrides: [
          socketServiceProvider.overrideWithValue(socketService),
          chatRepositoryProvider.overrideWithValue(chatRepository),
          userPermissionsProvider.overrideWith(
            (ref) async => [UserPermissions.viewReferenceDocument],
          ),
        ],
      );

      expect(find.byKey(const ValueKey('audio-waveform-container')), findsOneWidget);

      // Starts in focus mode (matching RN), which hides the transcript —
      // leave it to see the hydrated transcript/nudge area.
      await tester.tap(find.byKey(const ValueKey('focus-mode-button')));
      await tester.pumpAndSettle();

      expect(find.textContaining('Hello, how can I help today?'), findsOneWidget);
      // RN: mm:ss since the chat started + the speaker label.
      expect(find.text('00:05 '), findsOneWidget);
      expect(find.text('You'), findsOneWidget); // sender 7 is this user

      // Streamed partials from the client: the live line is replaced in
      // place, then a final chunk appends a new line, in timestamp order.
      Map<String, dynamic> msg(int id, String content, String at, {bool isFinal = false}) => {
        'payload': {
          'type': MessageType.text,
          'id': id,
          'content': content,
          'senderId': 9,
          'createdAt': at,
          'isFinal': isFinal,
          'isSentenceComplete': isFinal,
        },
      };
      callbacks[SocketEvent.messageReceived]!(msg(2, 'I feel', '2026-01-01T10:00:10.000Z'));
      await tester.pumpAndSettle();
      expect(find.textContaining('I feel'), findsOneWidget);
      callbacks[SocketEvent.messageReceived]!(msg(2, 'I feel tired', '2026-01-01T10:00:10.000Z', isFinal: true));
      await tester.pumpAndSettle();
      expect(find.textContaining('I feel tired'), findsOneWidget);
      expect(find.text('Client'), findsOneWidget);
      expect(find.text('00:10 '), findsOneWidget);
      final helloY = tester.getTopLeft(find.textContaining('Hello, how can I help today?')).dy;
      final tiredY = tester.getTopLeft(find.textContaining('I feel tired')).dy;
      expect(tiredY, greaterThan(helloY));

      // Pause starts `true` (matching RN) — resume, then push a chunk and
      // confirm it's actually emitted with the real RN-shaped payload.
      // RN starts paused with the "Resume to let it listen" tooltip up.
      expect(find.byKey(const ValueKey('mute-tooltip')), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('pause-resume-button')));
      // Debounced 500 ms (RN useDebounce).
      await tester.pump();
      expect(find.byKey(const ValueKey('mute-tooltip')), findsOneWidget);
      await tester.pump(const Duration(milliseconds: 600));
      expect(find.byKey(const ValueKey('mute-tooltip')), findsNothing);
      chunkController.add(Uint8List.fromList(List.filled(10, 0)));
      await tester.pump();

      final emittedCalls = verify(
        () => socketService.emit(SocketEvent.audioMessage, captureAny()),
      )..called(1);
      final payload = emittedCalls.captured.single as Map<String, dynamic>;
      expect(payload['chatId'], 42);
      expect(payload['audioData'], isA<String>());

      // `pumpAndSettle()` is unusable from here on: resuming above started
      // `AudioWaveformContainer`'s own 120ms `Timer.periodic` redraw loop,
      // which (by design — see `audio_waveform.dart`) keeps scheduling new
      // frames for as long as the call is unpaused, so `pumpAndSettle()`
      // never finds a quiet frame to stop on (same class of issue as
      // `roleplay_voice_screen`'s session timer, documented in that
      // screen's own tests). Bounded `pump()` calls instead.
      //
      // Also close the fake platform stream before ending the session —
      // real `record` package quirk, confirmed by isolating it directly:
      // `AudioRecorder.stop()` awaits its internal stream subscription's
      // `cancel()`/the wrapper controller's `close()`, and under this
      // harness's `FakeAsync` zone that hangs forever if the *source*
      // platform stream (this test's own `chunkController`) is still open
      // — exactly what the real native platform does on its own when
      // recording actually stops, just not something this fake simulates
      // automatically.
      await chunkController.close();
      await tester.pump();

      await tester.tap(find.byKey(const ValueKey('end-session-button')));
      await tester.pump(const Duration(milliseconds: 300)); // dialog entrance transition
      await tester.tap(find.byKey(const ValueKey('call-illustrated-modal-action')));
      await tester.pump(const Duration(milliseconds: 300));

      verify(() => chatRepository.endCall(42)).called(1);
      verify(() => socketService.disconnect()).called(greaterThanOrEqualTo(1));
    },
  );
}
