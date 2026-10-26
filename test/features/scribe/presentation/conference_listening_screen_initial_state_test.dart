import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/core/auth/auth_state.dart';
import 'package:ally_mobile_flutter/core/network/token_storage.dart';
import 'package:ally_mobile_flutter/features/scribe/presentation/conference_listening_screen.dart';

class MockTokenStorage extends Mock implements TokenStorage {}

// One `testWidgets` per file — see
// scribe_recording_screen_initial_state_test.dart for why.
//
// Not using the shared `pumpApp()` helper here: it ends in
// `pumpAndSettle()`, which never returns while this screen shows its
// waiting-for-client `CircularProgressIndicator` — an indeterminate spinner
// schedules a new frame forever, and (confirmed from source) RN's own
// conference screen has no timeout/terminating condition on this state at
// all, unlike Scribe's sibling screen (whose 5s chat-id timeout eventually
// gives `pumpAndSettle()` a stable frame to land on). Replicated `pumpApp`'s
// setup manually, with a bounded `pump()` instead.
void main() {
  testWidgets('auto-connects on mount and shows the waiting-for-client spinner state', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    final tokenStorage = MockTokenStorage();
    when(() => tokenStorage.accessToken).thenAnswer((_) async => null);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [tokenStorageProvider.overrideWithValue(tokenStorage)],
        child: const MaterialApp(
          home: ConferenceListeningScreen(chatId: 1, userId: 'user-1'),
        ),
      ),
    );
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
    await tester.pump();

    // No access token is stored in this harness, so `SocketService.connect`
    // no-ops before ever creating a real socket (same gotcha documented on
    // scribe_recording_screen_initial_state_test.dart) — this screen should
    // degrade to the waiting state rather than crash.
    expect(find.text('Waiting for the client to join'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });
}
