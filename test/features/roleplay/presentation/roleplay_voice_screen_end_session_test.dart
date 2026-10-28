import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:permission_handler_platform_interface/permission_handler_platform_interface.dart';

import 'package:ally_mobile_flutter/core/realtime/livekit_room_service.dart';
import 'package:ally_mobile_flutter/features/roleplay/presentation/roleplay_voice_screen.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulations_repository.dart';

import '../../../support/fake_permission_platform.dart';
import '../../../support/pump_app.dart';
import 'roleplay_test_mocks.dart';

// See roleplay_voice_screen_initial_state_test.dart for why this screen's
// tests are one-`testWidgets`-per-file.
void main() {
  testWidgets('end session calls endScenarioSession and disconnects the room', (tester) async {
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

    await pumpApp(
      tester,
      const RoleplayVoiceScreen(
        liveKitServerUrl: 'wss://x',
        accessToken: 'tok',
        scenarioSessionId: 'sess-1',
      ),
      overrides: [
        liveKitRoomServiceProvider.overrideWithValue(liveKitService),
        simulationsRepositoryProvider.overrideWithValue(simulationsRepository),
      ],
    );
    await tester.tap(find.text('Connect'));
    await tester.pump();
    // See roleplay_voice_screen_connected_flow_test.dart: the 3-2-1
    // countdown blocks the live-call UI for 3s after connecting, and the
    // session timer it starts is a live `Timer.periodic` for the rest of
    // this test — bounded `pump()` from here on, not `pumpAndSettle()`.
    await tester.pump(const Duration(seconds: 3));
      await expandRoleplayControls(tester);
    expect(find.text('End session'), findsOneWidget);

    // The new participant tiles push this button below this test's 600px
    // viewport — scroll it into view (the body is a `SingleChildScrollView`).
    await tester.ensureVisible(find.text('End session'));
    await tester.pump(const Duration(milliseconds: 500));
    await tester.tap(find.text('End session'));
    await tester.pump();

    // Navigating to SimulationFeedbackScreen needs a real GoRouter ancestor,
    // which this harness doesn't provide (pump_app.dart wraps with a plain
    // MaterialApp — see its doc comment), so `context.pushReplacement(...)`
    // throws "No GoRouter found in context" here. That's caught by the
    // screen's own try/catch and surfaces as an "end simulation" error
    // instead of a navigation — a harness limitation, not a real bug, so
    // this test doesn't assert on post-navigation UI. What it verifies are
    // the two real calls the button must make regardless of what happens
    // to navigation afterward.
    verify(() => simulationsRepository.endScenarioSession('sess-1')).called(1);
    verify(() => liveKitService.disconnect()).called(1);
  });
}
