import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';
import 'package:ally_mobile_flutter/core/realtime/socket_events.dart';
import 'package:ally_mobile_flutter/core/realtime/socket_service.dart';
import 'package:ally_mobile_flutter/core/settings/settings_repository.dart';
import 'package:ally_mobile_flutter/features/scribe/data/chat_models.dart';
import 'package:ally_mobile_flutter/features/scribe/data/chat_repository.dart';
import 'package:ally_mobile_flutter/features/scribe/presentation/conference_listening_screen.dart';

class MockSocketService extends Mock implements SocketService {}

class MockChatRepository extends Mock implements ChatRepository {}

// One `testWidgets` per file — see
// scribe_recording_screen_initial_state_test.dart for why.
//
// Not using the shared `pumpApp()` helper: see
// conference_listening_screen_initial_state_test.dart's doc comment — its
// `pumpAndSettle()` never returns while this screen's initial
// waiting-for-client spinner shows, since RN's own conference screen (and
// so this port) has no timeout ending that state on its own.
void main() {
  testWidgets(
    'USER_JOINED hydrates the chat (timer), AUDIO_STREAM draws the waveform, NUDGE shows the '
    'nudge section once out of focus mode, and both pause/end controls stay hidden (matching '
    "RN's real configuration)",
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
            invocation.namedArguments[#eventCallbacks] as Map<String, void Function(dynamic data)>;
      });
      when(() => socketService.disconnect()).thenAnswer((_) {});
      when(() => socketService.emit(any(), any())).thenAnswer((_) {});
      when(() => chatRepository.getCounsellorChat()).thenAnswer(
        (_) async => Chat(
          chatId: 42,
          status: ChatStatus.active,
          provider: ChatProvider.exotelConferenceCall,
          startedAt: '2026-01-01T10:00:00.000Z',
        ),
      );

      SharedPreferences.setMockInitialValues({});
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            socketServiceProvider.overrideWithValue(socketService),
            chatRepositoryProvider.overrideWithValue(chatRepository),
            userPermissionsProvider.overrideWith(
              (ref) async => [UserPermissions.viewReferenceDocument],
            ),
            // This test's whole point is proving a NUDGE event renders the
            // nudge section, so the tenant toggle must read enabled here —
            // the "tenant has nudges off" case has its own test file.
            nudgeStatusProvider.overrideWith((ref) async => true),
          ],
          child: const MaterialApp(
            home: ConferenceListeningScreen(chatId: 42, userId: 'user-1'),
          ),
        ),
      );
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
      await tester.pump();

      expect(find.byKey(const ValueKey('listening-connecting')), findsOneWidget);

      // Bounded `pump()` from here on, not `pumpAndSettle()`: this screen's
      // waveform is never "paused" (there's no pause concept for a
      // conference call), so `AudioWaveformContainer`'s own 120ms
      // `Timer.periodic` redraw loop starts the moment this body mounts and
      // keeps scheduling frames forever — the same class of issue already
      // documented on the Scribe/roleplay screens' own tests.
      callbacks[SocketEvent.userJoined]!(null);
      await tester.pump();
      await tester.pump();

      expect(find.byKey(const ValueKey('audio-waveform-container')), findsOneWidget);
      // RN's own real configuration hides both — confirmed from source, not
      // an oversight: a conference call can't be paused/ended from here.
      expect(find.byKey(const ValueKey('pause-resume-button')), findsNothing);
      expect(find.byKey(const ValueKey('end-session-button')), findsNothing);
      // Conference provider → the focus-mode banner shows.
      expect(find.byKey(const ValueKey('dismissable-banner')), findsOneWidget);

      callbacks[SocketEvent.audioStream]!({
        'payload': {'audioData': base64Encode(List.filled(20, 200))},
      });
      await tester.pump(const Duration(milliseconds: 150));

      // Leave focus mode (the default) to see the nudge section.
      await tester.tap(find.byKey(const ValueKey('focus-mode-button')));
      await tester.pump();

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

      expect(find.text('Try an open question.'), findsOneWidget);

      // RN: CHAT_ENDED replaces the screen with box breathing (no router in
      // this harness, so it must simply not throw).
      callbacks[SocketEvent.chatEnded]!(null);
      await tester.pump();
    },
  );
}
