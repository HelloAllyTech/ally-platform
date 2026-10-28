import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:permission_handler_platform_interface/permission_handler_platform_interface.dart';

import 'package:ally_mobile_flutter/core/realtime/livekit_room_service.dart';
import 'package:ally_mobile_flutter/features/roleplay/presentation/roleplay_voice_screen.dart';

import '../../../support/fake_permission_platform.dart';
import '../../../support/pump_app.dart';
import 'roleplay_test_mocks.dart';

// See roleplay_voice_screen_initial_state_test.dart for why this screen's
// tests are one-`testWidgets`-per-file. Connect, mute-toggle, and
// disconnect are exercised here as one continuous scenario (same mocks,
// same single pump) rather than three separate tests, precisely to stay
// within that one-pump-per-file constraint.
void main() {
  testWidgets(
    'connect shows connected controls; mute toggles; disconnect returns to not-connected',
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

      await pumpApp(
        tester,
        const RoleplayVoiceScreen(liveKitServerUrl: 'wss://x', accessToken: 'tok'),
        overrides: [liveKitRoomServiceProvider.overrideWithValue(liveKitService)],
      );

      await tester.tap(find.text('Connect'));
      await tester.pump();
      // A fixed 3-2-1 countdown overlay blocks the live-call UI for 3s after
      // connecting (mirrors RN's own SimulationCountdown) — advance past it
      // explicitly; `pump(duration)` already rebuilds once after firing the
      // pending timers, so no extra pump is needed to see the result.
      //
      // From here on this screen's session timer is a live
      // `Timer.periodic` (1 tick/second) for the rest of the test, so every
      // later step uses a bounded `pump()` instead of `pumpAndSettle()` —
      // the periodic `setState` keeps scheduling new frames forever, which
      // `pumpAndSettle()` would wait on indefinitely (same class of issue
      // as this codebase's other indefinite-animation gotchas).
      await tester.pump(const Duration(seconds: 3));
      await expandRoleplayControls(tester);

      expect(find.byKey(const ValueKey('participant-tile-remote')), findsOneWidget);
      expect(find.text('Mute'), findsOneWidget);
      expect(find.text('Disconnect'), findsOneWidget);
      verify(() => liveKitService.connect(liveKitServerUrl: 'wss://x', accessToken: 'tok')).called(1);
      verify(() => liveKitService.setMicrophoneEnabled(true)).called(1);

      // The new participant tiles push these buttons below this test's
      // 600px viewport — scroll them into view before tapping (the body is
      // a `SingleChildScrollView`, so they're reachable, just not visible
      // at the initial scroll offset).
      await tester.ensureVisible(find.text('Mute'));
      await tester.pump(const Duration(milliseconds: 500));
      await tester.tap(find.text('Mute'));
      await tester.pump();

      expect(find.text('Unmute'), findsOneWidget);
      verify(() => liveKitService.setMicrophoneEnabled(false)).called(1);

      await tester.ensureVisible(find.text('Disconnect'));
      await tester.pump(const Duration(milliseconds: 500));
      await tester.tap(find.text('Disconnect'));
      await tester.pump();

      expect(find.text('Connecting to session...'), findsOneWidget);
      verify(() => liveKitService.disconnect()).called(1);
    },
  );
}
