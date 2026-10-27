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
  testWidgets(
    'a live-event message with text shows the coaching toast, and a new one replaces it',
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
          ),
        ),
        overrides: [liveKitRoomServiceProvider.overrideWithValue(liveKitService)],
      );

      await tester.tap(find.text('Connect'));
      await tester.pump();
      await tester.pump(const Duration(seconds: 3));

      expect(find.text('Try asking an open question.'), findsNothing);

      liveKitService.emitData({
        'data': {'message': 'Try asking an open question.', 'emoji': '💡'},
      });
      await tester.pump();
      await tester.pump();

      expect(find.text('Try asking an open question.'), findsOneWidget);
      expect(find.text('💡'), findsOneWidget);

      liveKitService.emitData({
        'data': {'message': 'Good, keep going.'},
      });
      await tester.pump();
      await tester.pump();

      // Replaced in place — RN never shows two at once and never clears it
      // back to nothing on its own.
      expect(find.text('Try asking an open question.'), findsNothing);
      expect(find.text('Good, keep going.'), findsOneWidget);
      // No emoji on this message — falls back to the default.
      expect(find.text('🙂'), findsOneWidget);
    },
  );
}
