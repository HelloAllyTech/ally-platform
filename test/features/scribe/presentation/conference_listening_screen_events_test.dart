import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/realtime/socket_events.dart';
import 'package:ally_mobile_flutter/core/realtime/socket_service.dart';
import 'package:ally_mobile_flutter/features/scribe/data/chat_repository.dart';
import 'package:ally_mobile_flutter/features/scribe/presentation/conference_listening_screen.dart';

import '../../../support/pump_app.dart';

class MockSocketService extends Mock implements SocketService {}

class MockChatRepository extends Mock implements ChatRepository {}

// One `testWidgets` per file — see
// scribe_recording_screen_initial_state_test.dart for why.
void main() {
  testWidgets(
    'USER_JOINED/AUDIO_STREAM/NUDGE update the live counters; End session calls endCall and disconnects',
    (tester) async {
      final socketService = MockSocketService();
      final chatRepository = MockChatRepository();
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
            invocation.namedArguments[#eventCallbacks]
                as Map<String, void Function(dynamic data)>;
        (invocation.namedArguments[#onConnect] as void Function()?)?.call();
      });
      when(() => socketService.disconnect()).thenAnswer((_) {});
      when(() => socketService.emit(any(), any())).thenAnswer((_) {});
      when(() => chatRepository.endCall(42)).thenAnswer((_) async {});

      await pumpApp(
        tester,
        const ConferenceListeningScreen(chatId: 42, userId: 'user-1'),
        overrides: [
          socketServiceProvider.overrideWithValue(socketService),
          chatRepositoryProvider.overrideWithValue(chatRepository),
        ],
      );

      expect(find.textContaining('connected'), findsOneWidget);
      expect(find.text('Waiting for the client to join'), findsOneWidget);

      callbacks[SocketEvent.userJoined]!(null);
      callbacks[SocketEvent.audioStream]!(null);
      callbacks[SocketEvent.audioStream]!(null);
      callbacks[SocketEvent.nudge]!(null);
      await tester.pump();

      expect(find.text('Client joined'), findsOneWidget);
      expect(find.text('Audio chunks received: 2'), findsOneWidget);
      expect(find.text('Nudges received: 1'), findsOneWidget);

      await tester.tap(find.text('Pause nudges'));
      await tester.pump();

      expect(find.text('Resume nudges'), findsOneWidget);
      verify(() => socketService.emit(SocketEvent.audioChatPaused, {})).called(1);

      await tester.tap(find.text('End session'));
      await tester.pumpAndSettle();

      verify(() => chatRepository.endCall(42)).called(1);
      // Called once by `_endSession()` and once more by `dispose()` once
      // the pop above unmounts the screen — `disconnect()` is idempotent by
      // design (guarded by a null check on the socket), so both are fine.
      verify(() => socketService.disconnect()).called(greaterThanOrEqualTo(1));
    },
  );
}
