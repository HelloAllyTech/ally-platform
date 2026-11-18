import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:permission_handler_platform_interface/permission_handler_platform_interface.dart';

import 'package:ally_mobile_flutter/core/realtime/livekit_room_service.dart';
import 'package:ally_mobile_flutter/features/roleplay/presentation/roleplay_voice_screen.dart';

import '../../../support/fake_permission_platform.dart';
import '../../../support/pump_router_app.dart';
import 'roleplay_test_mocks.dart';

// See roleplay_voice_screen_initial_state_test.dart for why this screen's
// tests are one-`testWidgets`-per-file.
void main() {
  testWidgets(
    'a room closed by the agent/server replaces the call with Feedback (RN onDisconnected)',
    (tester) async {
      PermissionHandlerPlatform.instance = FakePermissionHandlerPlatform({});
      final liveKitService = MockLiveKitRoomService();
      when(
        () => liveKitService.connect(
          liveKitServerUrl: any(named: 'liveKitServerUrl'),
          accessToken: any(named: 'accessToken'),
        ),
      ).thenAnswer((_) async {});
      when(() => liveKitService.setMicrophoneEnabled(any()))
          .thenAnswer((_) async {});
      when(() => liveKitService.disconnect()).thenAnswer((_) async {});

      final router = await pumpRouterApp(
        tester,
        initialLocation: '/home',
        routes: [
          GoRoute(
            path: '/home',
            builder: (context, state) => const Text('HOME'),
          ),
          GoRoute(
            path: '/roleplay',
            builder: (context, state) => const RoleplayVoiceScreen(
              liveKitServerUrl: 'wss://x',
              accessToken: 'tok',
              scenarioSessionId: 'sess-9',
            ),
          ),
          GoRoute(
            path: '/simulations/feedback/:id',
            builder: (context, state) =>
                Text('FEEDBACK ${state.pathParameters['id']}'),
          ),
        ],
        overrides: [
          liveKitRoomServiceProvider.overrideWithValue(liveKitService),
        ],
      );
      router.push('/roleplay');
      await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds: 3));
      await joinAgent(tester, liveKitService);
      // The agent joined but stayed silent: the 1.5 s grace still promotes
      // the room to AGENT_JOINED (the call stays up).
      await tester.pump(const Duration(milliseconds: 1600));
      expect(
        find.byKey(const ValueKey('participant-tile-remote')),
        findsOneWidget,
      );

      // e.g. `cap-ended` followed by the agent tearing the room down.
      liveKitService.emitData({'type': 'cap-ended'});
      liveKitService.emitDisconnected();
      await tester.pump();
      await tester.pumpAndSettle();

      expect(find.text('FEEDBACK sess-9'), findsOneWidget);
    },
  );
}
