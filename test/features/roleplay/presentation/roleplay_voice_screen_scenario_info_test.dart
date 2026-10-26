import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:permission_handler_platform_interface/permission_handler_platform_interface.dart';

import 'package:ally_mobile_flutter/core/realtime/livekit_room_service.dart';
import 'package:ally_mobile_flutter/features/roleplay/presentation/roleplay_voice_screen.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulation_models.dart';

import '../../../support/fake_permission_platform.dart';
import '../../../support/pump_app.dart';
import 'roleplay_test_mocks.dart';

// See roleplay_voice_screen_initial_state_test.dart for why this screen's
// tests are one-`testWidgets`-per-file.
void main() {
  testWidgets('Details toggles the scenario-info panel with the title and trigger warnings', (
    tester,
  ) async {
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
      RoleplayVoiceScreen(
        liveKitServerUrl: 'wss://x',
        accessToken: 'tok',
        scenario: Scenario(
          id: 1,
          title: 'A difficult conversation',
          description: null,
          coverImageUrl: null,
          triggerWarnings: const ['Self-harm', 'Grief'],
        ),
      ),
      overrides: [liveKitRoomServiceProvider.overrideWithValue(liveKitService)],
    );

    await tester.tap(find.text('Connect'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 3));

    expect(find.text('A difficult conversation'), findsNothing);

    // The new participant tiles push this button below this test's 600px
    // viewport — scroll it into view (the body is a `SingleChildScrollView`).
    await tester.ensureVisible(find.text('Details'));
    await tester.pump(const Duration(milliseconds: 500));
    await tester.tap(find.text('Details'));
    await tester.pump();

    expect(find.text('A difficult conversation'), findsOneWidget);
    expect(find.text('Self-harm • Grief'), findsOneWidget);

    await tester.ensureVisible(find.text('Details'));
    await tester.pump(const Duration(milliseconds: 500));
    await tester.tap(find.text('Details'));
    await tester.pump();

    expect(find.text('A difficult conversation'), findsNothing);
  });
}
