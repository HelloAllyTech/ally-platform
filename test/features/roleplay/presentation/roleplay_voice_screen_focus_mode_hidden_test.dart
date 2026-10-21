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
  testWidgets('the focus button is hidden for a NONE experience mode', (tester) async {
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
          title: '',
          description: null,
          coverImageUrl: null,
          experienceMode: 'NONE',
        ),
      ),
      overrides: [liveKitRoomServiceProvider.overrideWithValue(liveKitService)],
    );

    await tester.tap(find.text('Connect'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 3));

    expect(find.text('Turn focus mode on'), findsNothing);
  });
}
