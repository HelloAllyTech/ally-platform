import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:permission_handler_platform_interface/permission_handler_platform_interface.dart';

import 'package:ally_mobile_flutter/core/realtime/livekit_room_service.dart';
import 'package:ally_mobile_flutter/features/roleplay/presentation/roleplay_voice_screen.dart';

import '../../../support/fake_permission_platform.dart';
import '../../../support/pump_app.dart';
import 'roleplay_test_mocks.dart';

// See roleplay_voice_screen_initial_state_test.dart for why this screen's
// tests are one-`testWidgets`-per-file.
void main() {
  testWidgets('denied mic permission shows an error and never attempts to connect', (tester) async {
    PermissionHandlerPlatform.instance = FakePermissionHandlerPlatform({
      Permission.microphone: PermissionStatus.denied,
    });
    final liveKitService = MockLiveKitRoomService();
    // dispose() always calls disconnect() — see
    // roleplay_voice_screen_initial_state_test.dart for why this must be
    // stubbed in every test, not just the ones that exercise it directly.
    when(() => liveKitService.disconnect()).thenAnswer((_) async {});

    await pumpApp(
      tester,
      const RoleplayVoiceScreen(liveKitServerUrl: 'wss://x', accessToken: 'tok'),
      overrides: [liveKitRoomServiceProvider.overrideWithValue(liveKitService)],
    );

    await tester.tap(find.text('Connect'));
    await tester.pumpAndSettle();

    expect(find.text('Microphone permission required'), findsOneWidget);
    expect(find.text('Not connected'), findsOneWidget);
    verifyNever(
      () => liveKitService.connect(
        liveKitServerUrl: any(named: 'liveKitServerUrl'),
        accessToken: any(named: 'accessToken'),
      ),
    );
  });
}
