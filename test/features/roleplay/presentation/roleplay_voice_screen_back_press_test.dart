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
    'backing out mid-session prompts "End Simulation?"; Cancel stays, confirming ends the call',
    (tester) async {
      PermissionHandlerPlatform.instance = FakePermissionHandlerPlatform({});
      final liveKitService = MockLiveKitRoomService();
      when(
        () => liveKitService.connect(
          liveKitServerUrl: any(named: 'liveKitServerUrl'),
          accessToken: any(named: 'accessToken'),
        ),
      ).thenAnswer((_) async {});
      when(() => liveKitService.setMicrophoneEnabled(any())).thenAnswer((_) async {});
      when(() => liveKitService.disconnect()).thenAnswer((_) async {});

      final router = await pumpRouterApp(
        tester,
        initialLocation: '/home',
        routes: [
          GoRoute(path: '/home', builder: (context, state) => const Text('HOME')),
          GoRoute(
            path: '/roleplay',
            builder: (context, state) => const RoleplayVoiceScreen(
              liveKitServerUrl: 'wss://x',
              accessToken: 'tok',
            ),
          ),
        ],
        overrides: [liveKitRoomServiceProvider.overrideWithValue(liveKitService)],
      );
      router.push('/roleplay');
      await tester.pumpAndSettle();

      // Before connecting, back just leaves — no confirmation needed.
      await tester.tap(find.byIcon(Icons.arrow_back));
      await tester.pumpAndSettle();
      expect(find.text('End Role play'), findsNothing);
      expect(find.text('HOME'), findsOneWidget);
      // dispose() always disconnects, regardless of connection state —
      // consume that expected call before the later verifyNever below.
      verify(() => liveKitService.disconnect()).called(1);

      router.push('/roleplay');
      await tester.pumpAndSettle();

      await tester.tap(find.text('Connect'));
      await tester.pump();
      await tester.pump(const Duration(seconds: 3)); // past the countdown

      await tester.tap(find.byIcon(Icons.arrow_back));
      await tester.pump();

      expect(find.text('End Role play'), findsOneWidget);
      expect(find.text('Are you sure you want to end the session?'), findsOneWidget);

      await tester.tap(find.text('Cancel'));
      await tester.pump();

      expect(find.text('End Role play'), findsNothing);
      expect(find.text('Connected to room'), findsOneWidget, reason: 'cancel stays on the call');
      verifyNever(() => liveKitService.disconnect());

      await tester.tap(find.byIcon(Icons.arrow_back));
      await tester.pump();
      await tester.tap(find.text('End session').last);
      await tester.pump();

      verify(() => liveKitService.disconnect()).called(1);
    },
  );
}
