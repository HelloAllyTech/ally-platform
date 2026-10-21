import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:permission_handler_platform_interface/permission_handler_platform_interface.dart';

import 'package:ally_mobile_flutter/core/realtime/livekit_room_service.dart';
import 'package:ally_mobile_flutter/features/roleplay/presentation/roleplay_voice_screen.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulation_models.dart';

import '../../../support/fake_permission_platform.dart';
import '../../../support/pump_app.dart';
import 'roleplay_test_mocks.dart';

Scenario _scenario({String? maxTimeValue}) => Scenario(
  id: 1,
  title: 'A role play',
  description: null,
  coverImageUrl: null,
  maxTimeValue: maxTimeValue,
);

// See roleplay_voice_screen_initial_state_test.dart for why this screen's
// tests are one-`testWidgets`-per-file.
void main() {
  testWidgets(
    'hitting the 30s-remaining threshold shows the warning dialog; Continue dismisses it',
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

      var elapsed = Duration.zero;
      await pumpApp(
        tester,
        RoleplayVoiceScreen(
          liveKitServerUrl: 'wss://x',
          accessToken: 'tok',
          // 31s max — the warning (<=30s remaining) fires on the very first
          // tick (elapsed=1s, remaining=30s), keeping this test fast.
          scenario: _scenario(maxTimeValue: '00:00:31'),
          now: () => DateTime(2026, 1, 1).add(elapsed),
        ),
        overrides: [liveKitRoomServiceProvider.overrideWithValue(liveKitService)],
      );

      await tester.tap(find.text('Connect'));
      await tester.pump();
      await tester.pump(const Duration(seconds: 3)); // past the countdown

      expect(find.text('Session Ending Soon'), findsNothing);

      elapsed = const Duration(seconds: 1);
      await tester.pump(const Duration(seconds: 1));

      expect(find.text('Session Ending Soon'), findsOneWidget);
      expect(find.text('Your session will end in 30 seconds.'), findsOneWidget);

      await tester.tap(find.text('Continue'));
      await tester.pump();

      expect(find.text('Session Ending Soon'), findsNothing);
      verifyNever(() => liveKitService.disconnect());
    },
  );
}
