import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:permission_handler_platform_interface/permission_handler_platform_interface.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/core/realtime/livekit_room_service.dart';
import 'package:ally_mobile_flutter/features/roleplay/presentation/roleplay_voice_screen.dart';

import '../../../support/fake_permission_platform.dart';
import 'roleplay_test_mocks.dart';

// See roleplay_voice_screen_initial_state_test.dart for why this screen's
// tests are one-`testWidgets`-per-file.
void main() {
  testWidgets(
    'a 3-2-1 countdown blocks the live-call UI, then a session timer starts',
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

      var elapsed = Duration.zero;
      // Not `pumpApp`: its trailing `pumpAndSettle` would step straight
      // through the countdown, which now starts on mount (RN).
      SharedPreferences.setMockInitialValues({});
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            liveKitRoomServiceProvider.overrideWithValue(liveKitService),
          ],
          child: MaterialApp(
            home: RoleplayVoiceScreen(
              liveKitServerUrl: 'wss://x',
              accessToken: 'tok',
              now: () => DateTime(2026, 1, 1).add(elapsed),
            ),
          ),
        ),
      );
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 300)),
      );
      await tester.pump();

      // Step 3, immediately — the countdown overlay covers the screen (the
      // live-call UI stays mounted underneath, just visually/pointer-blocked,
      // same as RN's own fixed overlay).
      expect(find.text('3'), findsOneWidget);

      await tester.pump(const Duration(seconds: 1));
      expect(find.text('2'), findsOneWidget);

      await tester.pump(const Duration(seconds: 1));
      expect(find.text('1'), findsOneWidget);

      await tester.pump(const Duration(seconds: 1));
      expect(
        find.text('1'),
        findsNothing,
        reason: 'countdown overlay gone once it reaches 0',
      );
      expect(
        find.byKey(const ValueKey('participant-tile-remote')),
        findsOneWidget,
      );
      // RN: the session clock starts when the agent joins the room.
      expect(find.textContaining('Session Duration:'), findsNothing);
      liveKitService.emitParticipantConnected();
      // One pump delivers the (async) stream event, the next builds it.
      await tester.pump();
      await tester.pump();
      expect(find.textContaining('Session Duration:'), findsOneWidget);

      // The session timer (a live Timer.periodic) is now running — bounded
      // pumps only from here, see roleplay_voice_screen_connected_flow_test.dart.
      // The test clock (`now`) must be advanced in lockstep with the virtual
      // pump time: the periodic Timer fires on fake-cleared time, but
      // `DateTime.now()`-style reads aren't themselves fast-forwarded by it.
      expect(find.textContaining('00:00'), findsOneWidget);
      elapsed = const Duration(seconds: 2);
      await tester.pump(const Duration(seconds: 2));
      expect(find.textContaining('00:02'), findsOneWidget);
    },
  );
}
