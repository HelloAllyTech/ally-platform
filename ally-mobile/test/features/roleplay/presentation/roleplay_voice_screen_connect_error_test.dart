import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:permission_handler_platform_interface/permission_handler_platform_interface.dart';

import 'package:ally_mobile_flutter/core/realtime/livekit_room_service.dart';
import 'package:ally_mobile_flutter/core/widgets/toast/toast.dart';
import 'package:ally_mobile_flutter/features/roleplay/presentation/roleplay_voice_screen.dart';

import '../../../support/fake_permission_platform.dart';
import '../../../support/pump_app.dart';
import 'roleplay_test_mocks.dart';

// See roleplay_voice_screen_initial_state_test.dart for why this screen's
// tests are one-`testWidgets`-per-file.
void main() {
  testWidgets(
    'an automatic connect() failure shows RN\'s connect-error toast, not inline text',
    (tester) async {
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
        const RoleplayVoiceScreen(
          liveKitServerUrl: 'wss://x',
          accessToken: 'tok',
        ),
        overrides: [
          liveKitRoomServiceProvider.overrideWithValue(liveKitService),
        ],
      );

      // The screen connects by itself on mount (RN `handleConnect` effect).
      await tester.pump(const Duration(seconds: 1));

      // RN `showErrorToast(error, 'errors.connect')`: a toast, not inline text.
      expect(
        find.descendant(
          of: find.byType(AppToast),
          matching: find.textContaining('Failed to connect to the room'),
        ),
        findsOneWidget,
      );

      // Transient: gone once the toast's 3s run is over.
      await tester.pump(const Duration(seconds: 4));
      await tester.pump(const Duration(seconds: 1));
      expect(find.textContaining('Failed to connect to the room'), findsNothing);
    },
  );
}
