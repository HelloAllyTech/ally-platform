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

// Own file, not a second `testWidgets` in conference_listening_screen_events_test.dart —
// see that file's own "one testWidgets per file" note.
//
// Not using the shared `pumpApp()` helper, for the same reason
// conference_listening_screen_initial_state_test.dart gives.
void main() {
  testWidgets(
    "a tenant with nudges disabled never shows the nudge section, even once a NUDGE event "
    "arrives — mirrors RN's `!!nudgeStatus && currentNudge` render gate in "
    'ConferenceListeningScreen.tsx',
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
            nudgeStatusProvider.overrideWith((ref) async => false),
          ],
          child: const MaterialApp(
            home: ConferenceListeningScreen(chatId: 42, userId: 'user-1'),
          ),
        ),
      );
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
      await tester.pump();

      callbacks[SocketEvent.userJoined]!(null);
      await tester.pump();
      await tester.pump();

      // Leave focus mode so the nudge section would render if it were going to.
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

      expect(find.text('Try an open question.'), findsNothing);
    },
  );
}
