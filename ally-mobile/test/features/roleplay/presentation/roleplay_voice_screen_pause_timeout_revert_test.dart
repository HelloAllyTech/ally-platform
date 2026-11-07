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
    'if the agent never acks a pause within 2.5s, the optimistic UI reverts and the mic '
    'is restored',
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

      await tester.ensureVisible(find.byKey(const ValueKey('pause-resume-button')));
      await tester.pump(const Duration(milliseconds: 500));
      await tester.tap(find.byKey(const ValueKey('pause-resume-button')));
      await tester.pump();

      expect(find.text('Resume'), findsOneWidget);

      // No 'paused' ack ever arrives — let the 2.5s ack timeout elapse.
      await tester.pump(const Duration(seconds: 3));

      expect(find.text('Pause'), findsOneWidget, reason: 'reverted back to not-paused');
      // 2 total: the initial connect, plus the revert's restore.
      verify(() => liveKitService.setMicrophoneEnabled(true)).called(2);
      expect(find.textContaining("Couldn't reach the session"), findsOneWidget);
    },
  );
}
