import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/realtime/livekit_room_service.dart';
import 'package:ally_mobile_flutter/features/roleplay/presentation/roleplay_voice_screen.dart';

import '../../../support/pump_app.dart';
import 'roleplay_test_mocks.dart';

// See roleplay_voice_screen_initial_state_test.dart for why this screen's
// tests are one-`testWidgets`-per-file.
//
// This is also the regression test for a real bug found while writing
// these tests: `dispose()` used to call `ref.read(liveKitRoomServiceProvider)`
// directly, which Riverpod documents as unsafe once a widget is mid-unmount
// — and it reliably threw here, since `flutter_test` unmounts the whole
// pumped tree (including its ProviderScope) at the end of every test. Fixed
// in roleplay_voice_screen.dart by resolving the service once in
// `initState()` and caching it in a field instead.
void main() {
  testWidgets('disposing the screen always disconnects the room', (tester) async {
    final liveKitService = MockLiveKitRoomService();
    when(() => liveKitService.disconnect()).thenAnswer((_) async {});

    await pumpApp(
      tester,
      const RoleplayVoiceScreen(liveKitServerUrl: 'wss://x', accessToken: 'tok'),
      overrides: [liveKitRoomServiceProvider.overrideWithValue(liveKitService)],
    );

    await tester.pumpWidget(const SizedBox.shrink());

    verify(() => liveKitService.disconnect()).called(1);
  });
}
