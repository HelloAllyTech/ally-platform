import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:permission_handler_platform_interface/permission_handler_platform_interface.dart';

import 'package:ally_mobile_flutter/core/realtime/livekit_room_service.dart';
import 'package:ally_mobile_flutter/features/roleplay/presentation/roleplay_voice_screen.dart';
import 'package:ally_mobile_flutter/features/roleplay/presentation/simulation_sound_player.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulations_repository.dart';

import '../../../support/fake_permission_platform.dart';
import '../../../support/pump_app.dart';
import 'roleplay_test_mocks.dart';

// See roleplay_voice_screen_initial_state_test.dart for why this screen's
// tests are one-`testWidgets`-per-file.
void main() {
  testWidgets(
    'plays RN startSimulation on mount and endSimulation on End session',
    (tester) async {
      PermissionHandlerPlatform.instance = FakePermissionHandlerPlatform({});
      final sound = FakeSimulationSoundPlayer();
      final liveKitService = MockLiveKitRoomService();
      final simulationsRepository = MockSimulationsRepository();
      when(
        () => liveKitService.connect(
          liveKitServerUrl: any(named: 'liveKitServerUrl'),
          accessToken: any(named: 'accessToken'),
        ),
      ).thenAnswer((_) async {});
      when(() => liveKitService.setMicrophoneEnabled(any()))
          .thenAnswer((_) async {});
      when(() => liveKitService.disconnect()).thenAnswer((_) async {});
      when(() => simulationsRepository.endScenarioSession('sess-1'))
          .thenAnswer((_) async {});

      await pumpApp(
        tester,
        const RoleplayVoiceScreen(
          liveKitServerUrl: 'wss://x',
          accessToken: 'tok',
          scenarioSessionId: 'sess-1',
        ),
        overrides: [
          liveKitRoomServiceProvider.overrideWithValue(liveKitService),
          simulationsRepositoryProvider.overrideWithValue(
            simulationsRepository,
          ),
          simulationSoundPlayerProvider.overrideWithValue(sound),
        ],
      );
      // See roleplay_voice_screen_connected_flow_test.dart: the 3-2-1
      // countdown blocks the live-call UI for 3s after connecting, and the
      // session timer it starts is a live `Timer.periodic` for the rest of
      // this test — bounded `pump()` from here on, not `pumpAndSettle()`.
      expect(sound.played, [SimulationSound.start]);
      await tester.pump(const Duration(seconds: 3));
      await expandRoleplayControls(tester);
      expect(find.text('End session'), findsOneWidget);

      // The new participant tiles push this button below this test's 600px
      // viewport — scroll it into view (the body is a `SingleChildScrollView`).
      await tester.ensureVisible(find.text('End session'));
      await tester.pump(const Duration(milliseconds: 500));
      await tester.tap(find.text('End session'));
      await tester.pump();

      expect(sound.played, [SimulationSound.start, SimulationSound.end]);
    },
  );
}
