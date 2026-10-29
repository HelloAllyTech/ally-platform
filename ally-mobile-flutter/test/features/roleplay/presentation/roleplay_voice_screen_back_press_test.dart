import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:permission_handler_platform_interface/permission_handler_platform_interface.dart';

import 'package:ally_mobile_flutter/core/realtime/livekit_room_service.dart';
import 'package:ally_mobile_flutter/features/roleplay/presentation/roleplay_voice_screen.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulations_repository.dart';

import '../../../support/fake_permission_platform.dart';
import '../../../support/pump_router_app.dart';
import 'roleplay_test_mocks.dart';

// See roleplay_voice_screen_initial_state_test.dart for why this screen's
// tests are one-`testWidgets`-per-file.
void main() {
  testWidgets(
    'back mid-session opens "End Role play"; the X keeps the call, End session leaves for Feedback',
    (tester) async {
      PermissionHandlerPlatform.instance = FakePermissionHandlerPlatform({});
      final liveKitService = MockLiveKitRoomService();
      final simulationsRepository = MockSimulationsRepository();
      when(
        () => liveKitService.connect(
          liveKitServerUrl: any(named: 'liveKitServerUrl'),
          accessToken: any(named: 'accessToken'),
        ),
      ).thenAnswer((_) async {});
      when(() => liveKitService.setMicrophoneEnabled(any()))
          .thenAnswer((_) async {});
      when(() => liveKitService.disconnect()).thenAnswer((_) async {});
      // RN navigates in a `finally`: a failed end call still leaves.
      when(() => simulationsRepository.endScenarioSession('sess-1'))
          .thenThrow(Exception('500'));

      final router = await pumpRouterApp(
        tester,
        initialLocation: '/home',
        routes: [
          GoRoute(
            path: '/home',
            builder: (context, state) => const Text('HOME'),
          ),
          GoRoute(
            path: '/roleplay',
            builder: (context, state) => const RoleplayVoiceScreen(
              liveKitServerUrl: 'wss://x',
              accessToken: 'tok',
              scenarioSessionId: 'sess-1',
            ),
          ),
          GoRoute(
            path: '/simulations/feedback/:id',
            builder: (context, state) =>
                Text('FEEDBACK ${state.pathParameters['id']}'),
          ),
        ],
        overrides: [
          liveKitRoomServiceProvider.overrideWithValue(liveKitService),
          simulationsRepositoryProvider.overrideWithValue(
            simulationsRepository,
          ),
        ],
      );
      router.push('/roleplay');
      await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds: 3)); // past the countdown

      // RN has no header back arrow on the live call: system back only.
      await tester.binding.handlePopRoute();
      await tester.pump();

      expect(find.text('End Role play'), findsOneWidget);
      expect(
        find.text('Are you sure you want to end the session?'),
        findsOneWidget,
      );

      // RN IllustratedModal: the X closes it (there's no Cancel button).
      await tester.tap(
        find.byKey(const ValueKey('call-illustrated-modal-close')),
      );
      await tester.pump();

      expect(find.text('End Role play'), findsNothing);
      expect(
        find.byKey(const ValueKey('participant-tile-remote')),
        findsOneWidget,
        reason: 'the X stays on the call',
      );
      verifyNever(() => liveKitService.disconnect());

      await tester.binding.handlePopRoute();
      await tester.pump();
      await tester.tap(
        find.byKey(const ValueKey('call-illustrated-modal-action')),
      );
      await tester.pumpAndSettle();

      verify(() => liveKitService.disconnect()).called(greaterThanOrEqualTo(1));
      verify(() => simulationsRepository.endScenarioSession('sess-1'))
          .called(1);
      expect(find.text('FEEDBACK sess-1'), findsOneWidget);
    },
  );
}
