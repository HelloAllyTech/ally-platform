import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:permission_handler_platform_interface/permission_handler_platform_interface.dart';

import 'package:ally_mobile_flutter/core/realtime/livekit_room_service.dart';
import 'package:ally_mobile_flutter/features/roleplay/presentation/roleplay_voice_screen.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulation_models.dart';

import '../../../support/fake_permission_platform.dart';
import '../../../support/pump_app.dart';
import 'roleplay_test_mocks.dart';

// One `testWidgets` per file — see
// roleplay_voice_screen_initial_state_test.dart for why.
void main() {
  testWidgets(
    'pausing optimistically mutes the mic and publishes "pause"; the agent ack is a no-op '
    'confirmation; resuming restores the mic and publishes "resume"',
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
      when(() => liveKitService.publishData(any())).thenAnswer((_) async {});

      await pumpApp(
        tester,
        RoleplayVoiceScreen(
          liveKitServerUrl: 'wss://x',
          accessToken: 'tok',
          scenario: Scenario(
            id: 1,
            title: '',
            description: null,
            coverImageUrl: null,
            pauseEnabled: true,
          ),
        ),
        overrides: [liveKitRoomServiceProvider.overrideWithValue(liveKitService)],
      );

      await tester.pump(const Duration(seconds: 3));
      await expandRoleplayControls(tester);

      expect(find.text('Pause'), findsOneWidget);

      await tester.ensureVisible(find.byKey(const ValueKey('pause-resume-button')));
      await tester.pump(const Duration(milliseconds: 500));
      await tester.tap(find.byKey(const ValueKey('pause-resume-button')));
      await tester.pump();

      expect(find.text('Resume'), findsOneWidget);
      // Optimistic: the mic is disabled immediately, before any ack.
      verify(() => liveKitService.setMicrophoneEnabled(false)).called(1);
      verify(() => liveKitService.publishData({'type': 'pause'})).called(1);

      // The agent's ack arrives and agrees with what the optimistic path
      // already applied — a pure confirmation, no further mic/state churn.
      liveKitService.emitData({'type': 'paused'});
      await tester.pump();
      await tester.pump();

      expect(find.text('Resume'), findsOneWidget);
      // Still just the one call from the initial connect — the ack caused
      // no further mic churn since it already matched the optimistic state.
      verify(() => liveKitService.setMicrophoneEnabled(true)).called(1);

      await tester.ensureVisible(find.byKey(const ValueKey('pause-resume-button')));
      await tester.pump(const Duration(milliseconds: 500));
      await tester.tap(find.byKey(const ValueKey('pause-resume-button')));
      await tester.pump();

      expect(find.text('Pause'), findsOneWidget);
      // `verify(...).called(n)` only counts calls since the previous
      // `verify` on the same mock/method (mocktail "consumes" matched
      // invocations) — this is the one new call from resuming.
      verify(() => liveKitService.setMicrophoneEnabled(true)).called(1);
      verify(() => liveKitService.publishData({'type': 'resume'})).called(1);
    },
  );
}
