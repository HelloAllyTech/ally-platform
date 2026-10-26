import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/auth/auth_state.dart';
import 'package:ally_mobile_flutter/core/network/token_storage.dart';
import 'package:ally_mobile_flutter/features/scribe/presentation/conference_listening_screen.dart';

import '../../../support/pump_app.dart';

class MockTokenStorage extends Mock implements TokenStorage {}

// One `testWidgets` per file — see
// scribe_recording_screen_initial_state_test.dart for why.
void main() {
  testWidgets('auto-connects on mount and shows the waiting-for-client state', (tester) async {
    final tokenStorage = MockTokenStorage();
    when(() => tokenStorage.accessToken).thenAnswer((_) async => null);

    await pumpApp(
      tester,
      const ConferenceListeningScreen(chatId: 1, userId: 'user-1'),
      overrides: [tokenStorageProvider.overrideWithValue(tokenStorage)],
    );

    // No access token is stored in this harness, so `SocketService.connect`
    // no-ops before ever creating a real socket (same gotcha documented on
    // scribe_recording_screen_initial_state_test.dart) — this screen should
    // degrade to the disconnected/waiting state rather than crash.
    expect(find.text('Waiting for the client to join'), findsOneWidget);
    expect(find.textContaining('disconnected'), findsOneWidget);
    expect(find.text('Audio chunks received: 0'), findsOneWidget);
    expect(find.text('Nudges received: 0'), findsOneWidget);
    expect(find.text('End session'), findsOneWidget);
    expect(find.text('Pause nudges'), findsOneWidget);
  });
}
