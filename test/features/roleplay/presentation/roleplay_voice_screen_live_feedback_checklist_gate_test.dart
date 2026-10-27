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
    'checklist mode suppresses the coaching toast — its own tab already surfaces progress',
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
            experienceMode: 'CHECKLIST',
            checklistType: 'GUIDED',
            checklistEvents: [ChecklistItem(id: 'evt-greet', name: 'Greet the client', rank: 1)],
          ),
        ),
        overrides: [liveKitRoomServiceProvider.overrideWithValue(liveKitService)],
      );

      await tester.tap(find.text('Connect'));
      await tester.pump();
      await tester.pump(const Duration(seconds: 3));

      liveKitService.emitData({
        'data': {'message': 'Try asking an open question.'},
      });
      await tester.pump();
      await tester.pump();

      expect(find.text('Try asking an open question.'), findsNothing);
    },
  );
}
