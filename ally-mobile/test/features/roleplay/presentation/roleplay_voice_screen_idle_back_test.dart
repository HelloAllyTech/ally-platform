import 'dart:async';

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
    'idle (not yet connected): iOS swipe-back is disabled (RN gestureEnabled:false) '
    'and Android back just leaves, with no confirmation',
    (tester) async {
      PermissionHandlerPlatform.instance = FakePermissionHandlerPlatform({});
      final liveKitService = MockLiveKitRoomService();
      // Never connects: the screen stays idle.
      final pending = Completer<void>();
      when(
        () => liveKitService.connect(
          liveKitServerUrl: any(named: 'liveKitServerUrl'),
          accessToken: any(named: 'accessToken'),
        ),
      ).thenAnswer((_) => pending.future);
      when(() => liveKitService.setMicrophoneEnabled(any())).thenAnswer((_) async {});
      when(() => liveKitService.disconnect()).thenAnswer((_) async {});

      final router = await pumpRouterApp(
        tester,
        initialLocation: '/home',
        routes: [
          GoRoute(path: '/home', builder: (context, state) => const Text('HOME')),
          GoRoute(
            path: '/roleplay',
            builder: (context, state) =>
                const RoleplayVoiceScreen(liveKitServerUrl: 'wss://x', accessToken: 'tok'),
          ),
        ],
        overrides: [liveKitRoomServiceProvider.overrideWithValue(liveKitService)],
      );
      router.push('/roleplay');
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));

      final route = ModalRoute.of(tester.element(find.byType(RoleplayVoiceScreen)))!;
      expect(route.popGestureEnabled, isFalse, reason: 'no iOS edge swipe on this screen');

      await tester.binding.handlePopRoute();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));

      expect(find.text('End Role play'), findsNothing);
      expect(find.text('HOME'), findsOneWidget);
      expect(find.byType(RoleplayVoiceScreen), findsNothing);
    },
  );
}
