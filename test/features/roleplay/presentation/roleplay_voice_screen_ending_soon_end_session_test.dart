import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:permission_handler_platform_interface/permission_handler_platform_interface.dart';

import 'package:ally_mobile_flutter/core/realtime/livekit_room_service.dart';
import 'package:ally_mobile_flutter/features/roleplay/presentation/roleplay_voice_screen.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulation_models.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulations_repository.dart';

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
  testWidgets('End session inside the warning dialog ends the session', (tester) async {
    PermissionHandlerPlatform.instance = FakePermissionHandlerPlatform({});
    final liveKitService = MockLiveKitRoomService();
    final simulationsRepository = MockSimulationsRepository();
    when(
      () => liveKitService.connect(
        liveKitServerUrl: any(named: 'liveKitServerUrl'),
        accessToken: any(named: 'accessToken'),
      ),
    ).thenAnswer((_) async {});
    when(() => liveKitService.setMicrophoneEnabled(any())).thenAnswer((_) async {});
    when(() => liveKitService.disconnect()).thenAnswer((_) async {});
    when(() => simulationsRepository.endScenarioSession('sess-1')).thenAnswer((_) async {});

    var elapsed = Duration.zero;
    await pumpApp(
      tester,
      RoleplayVoiceScreen(
        liveKitServerUrl: 'wss://x',
        accessToken: 'tok',
        scenarioSessionId: 'sess-1',
        scenario: _scenario(maxTimeValue: '00:00:31'),
        now: () => DateTime(2026, 1, 1).add(elapsed),
      ),
      overrides: [
        liveKitRoomServiceProvider.overrideWithValue(liveKitService),
        simulationsRepositoryProvider.overrideWithValue(simulationsRepository),
      ],
    );

    await tester.tap(find.text('Connect'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 3));
      await expandRoleplayControls(tester);
    elapsed = const Duration(seconds: 1);
    await tester.pump(const Duration(seconds: 1));

    expect(find.text('Session Ending Soon'), findsOneWidget);
    // Two "End session" buttons are on screen now: the screen's own
    // persistent destructive button, and the warning dialog's secondary
    // action — the dialog's is added last in the Stack.
    expect(find.text('End session'), findsNWidgets(2));

    await tester.tap(find.text('End session').last);
    await tester.pump();

    verify(() => simulationsRepository.endScenarioSession('sess-1')).called(1);
    verify(() => liveKitService.disconnect()).called(1);
  });
}
