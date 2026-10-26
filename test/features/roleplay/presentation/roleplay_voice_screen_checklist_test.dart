import 'package:flutter/widgets.dart';
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
    'a LiveKit detected_event_ids message checks off the matching checklist item in real time',
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
            checklistEvents: [
              ChecklistItem(id: 'evt-greet', name: 'Greet the client', rank: 1),
              ChecklistItem(id: 'evt-ask', name: 'Ask an open question', rank: 2),
            ],
          ),
        ),
        overrides: [liveKitRoomServiceProvider.overrideWithValue(liveKitService)],
      );

      await tester.tap(find.text('Connect'));
      await tester.pump();
      await tester.pump(const Duration(seconds: 3));

      expect(find.text('Session Checklist'), findsOneWidget);
      expect(find.textContaining('0 of 2'), findsOneWidget);
      expect(find.byKey(const ValueKey('checklist-status-evt-greet')), findsOneWidget);

      liveKitService.emitData({
        'data': {
          'detected_event_ids': ['evt-greet'],
        },
      });
      // Two pumps: the first lets the broadcast stream's `.add()` complete
      // its microtask round-trip to the subscription's callback, the
      // second renders the frame the resulting `setState` schedules.
      await tester.pump();
      await tester.pump();

      expect(find.textContaining('1 of 2'), findsOneWidget);
    },
  );
}
