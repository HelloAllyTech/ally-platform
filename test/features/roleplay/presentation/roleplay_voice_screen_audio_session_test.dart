import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:permission_handler_platform_interface/permission_handler_platform_interface.dart';

import 'package:ally_mobile_flutter/core/realtime/livekit_room_service.dart';
import 'package:ally_mobile_flutter/features/roleplay/presentation/roleplay_audio_session.dart';
import 'package:ally_mobile_flutter/features/roleplay/presentation/roleplay_voice_screen.dart';
import 'package:ally_mobile_flutter/features/roleplay/presentation/simulation_sound_player.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulations_repository.dart';

import '../../../support/fake_permission_platform.dart';
import '../../../support/pump_app.dart';
import 'roleplay_test_mocks.dart';

class _FailingAudioSession implements RoleplayAudioSession {
  _FailingAudioSession(this.log);
  final List<String> log;

  @override
  Future<void> configure() async {
    log.add('configure');
    throw Exception('no audio');
  }
}

// One `testWidgets` per file, as the other role-play screen tests.
void main() {
  testWidgets(
    'RN configureAudioSession runs before connect; a failure shows '
    'errors.audioSession and still connects; the start sound stops once '
    'the agent joins',
    (tester) async {
      PermissionHandlerPlatform.instance = FakePermissionHandlerPlatform({});
      final log = <String>[];
      final sound = FakeSimulationSoundPlayer();
      final liveKitService = MockLiveKitRoomService();
      when(
        () => liveKitService.connect(
          liveKitServerUrl: any(named: 'liveKitServerUrl'),
          accessToken: any(named: 'accessToken'),
        ),
      ).thenAnswer((_) async => log.add('connect'));
      when(() => liveKitService.setMicrophoneEnabled(any()))
          .thenAnswer((_) async {});
      when(() => liveKitService.disconnect()).thenAnswer((_) async {});

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
            MockSimulationsRepository(),
          ),
          simulationSoundPlayerProvider.overrideWithValue(sound),
          roleplayAudioSessionProvider.overrideWithValue(
            _FailingAudioSession(log),
          ),
        ],
      );
      await tester.pump(const Duration(milliseconds: 200));
      expect(log, ['configure', 'connect']);
      expect(find.text('Failed to configure audio session'), findsOneWidget);

      await tester.pump(const Duration(seconds: 3));
      expect(sound.stopCount, 0);
      await joinAgent(tester, liveKitService);
      // RN AGENT_SILENT_GRACE_MS: a silent agent counts as joined after 1.5s.
      await tester.pump(const Duration(milliseconds: 1600));
      expect(sound.stopCount, 1);
    },
  );
}
