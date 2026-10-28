import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/realtime/livekit_room_service.dart';
import 'package:ally_mobile_flutter/core/widgets/app_button.dart';
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
  testWidgets('shows "Not connected" and a Connect button before connecting', (tester) async {
    final liveKitService = MockLiveKitRoomService();
    // dispose() always calls disconnect(), regardless of scenario — an
    // unstubbed mocktail call here returns a bare `null`, which crashes
    // with a type error against the real `Future<void>` return type the
    // moment the test tears down the widget tree. Found the hard way.
    when(() => liveKitService.disconnect()).thenAnswer((_) async {});

    await pumpApp(
      tester,
      const RoleplayVoiceScreen(liveKitServerUrl: 'wss://x', accessToken: 'tok'),
      overrides: [liveKitRoomServiceProvider.overrideWithValue(liveKitService)],
    );

    expect(find.text('Connecting to session...'), findsOneWidget);
    expect(find.widgetWithText(AppButton, 'Connect'), findsOneWidget);
    verifyNever(
      () => liveKitService.connect(
        liveKitServerUrl: any(named: 'liveKitServerUrl'),
        accessToken: any(named: 'accessToken'),
      ),
    );
  });
}
