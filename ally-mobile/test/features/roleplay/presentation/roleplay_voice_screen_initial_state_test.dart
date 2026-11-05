import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/realtime/livekit_room_service.dart';
import 'package:ally_mobile_flutter/features/roleplay/presentation/roleplay_voice_screen.dart';

import '../../../support/pump_app.dart';
import 'roleplay_test_mocks.dart';

// One `testWidgets` per file across this screen's test files, deliberately.
// `localizationControllerProvider`'s `build()` does real async I/O
// (SharedPreferences + rootBundle.loadString — see pump_app.dart's doc
// comment), and a second full `pumpApp()` of a translation-dependent screen
// within the same test *file* (i.e. the same isolate) was found to
// reliably get stuck in `AsyncLoading` forever — confirmed independently
// with a minimal repro outside this screen entirely (a bare
// ConsumerWidget watching the provider directly), so it's a harness/isolate
// characteristic, not a bug in this screen or these tests. Splitting one
// scenario per file sidesteps it cleanly: each file gets a fresh isolate,
// so every file's single pump is a "first" pump and resolves normally.
// (Multiple `tester.tap`/`tester.pumpWidget` calls *within* one already-
// resolved test are unaffected — only a second brand-new
// provider/translation resolution attempt in the same isolate is.)
void main() {
  testWidgets(
    'connects on mount (no Connect tap) and enables the mic, as RN does',
    (tester) async {
      final liveKitService = MockLiveKitRoomService();
      // dispose() always calls disconnect(), regardless of scenario — an
      // unstubbed mocktail call here returns a bare `null`, which crashes
      // with a type error against the real `Future<void>` return type the
      // moment the test tears down the widget tree. Found the hard way.
      when(() => liveKitService.disconnect()).thenAnswer((_) async {});
      when(
        () => liveKitService.connect(
          liveKitServerUrl: any(named: 'liveKitServerUrl'),
          accessToken: any(named: 'accessToken'),
        ),
      ).thenAnswer((_) async {});
      when(() => liveKitService.setMicrophoneEnabled(any()))
          .thenAnswer((_) async {});

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

      // Past the 3-2-1 countdown that also starts on mount.
      await tester.pump(const Duration(seconds: 3));
      expect(find.text('Connect'), findsNothing);
      verify(
        () => liveKitService.connect(
          liveKitServerUrl: 'wss://x',
          accessToken: 'tok',
        ),
      ).called(1);
      verify(() => liveKitService.setMicrophoneEnabled(true)).called(1);
      // CONNECTED counts as in progress (RN `isSimulationInProgress`), so the
      // call UI shows; the session clock waits for the agent to join.
      expect(
        find.byKey(const ValueKey('participant-tile-remote')),
        findsOneWidget,
      );
      expect(find.textContaining('Session Duration'), findsNothing);
    },
  );
}
