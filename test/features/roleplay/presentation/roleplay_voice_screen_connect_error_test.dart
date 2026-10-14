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
  testWidgets('a connect() failure surfaces the connect-error message', (tester) async {
    PermissionHandlerPlatform.instance = FakePermissionHandlerPlatform({});
    final liveKitService = MockLiveKitRoomService();
    when(() => liveKitService.disconnect()).thenAnswer((_) async {});
    when(
      () => liveKitService.connect(
        liveKitServerUrl: any(named: 'liveKitServerUrl'),
        accessToken: any(named: 'accessToken'),
      ),
    ).thenThrow(Exception('boom'));

    await pumpApp(
      tester,
      const RoleplayVoiceScreen(liveKitServerUrl: 'wss://x', accessToken: 'tok'),
      overrides: [liveKitRoomServiceProvider.overrideWithValue(liveKitService)],
    );

    await tester.tap(find.text('Connect'));
    await tester.pumpAndSettle();

    expect(find.textContaining('Failed to connect to the room'), findsOneWidget);
  });
}
