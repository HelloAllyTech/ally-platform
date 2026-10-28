import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/core/navigation/home_tab_navigation.dart';
import 'package:ally_mobile_flutter/core/navigation/tab_config.dart';
import 'package:ally_mobile_flutter/core/auth/auth_state.dart';
import 'package:ally_mobile_flutter/core/network/token_storage.dart';
import 'package:ally_mobile_flutter/features/scribe/presentation/conference_listening_screen.dart';

class MockTokenStorage extends Mock implements TokenStorage {}

// One `testWidgets` per file — see
// scribe_recording_screen_initial_state_test.dart for why. Bounded pumps,
// not `pumpAndSettle()`: see conference_listening_screen_initial_state_test.
void main() {
  testWidgets(
    'Android back on a conference screen reached with go() lands on the Call Log tab '
    '(RN stack [CallLog, Listening]) instead of leaving the app',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      final tokenStorage = MockTokenStorage();
      when(() => tokenStorage.accessToken).thenAnswer((_) async => null);

      HomeTabRequest? homeRequest;
      final router = GoRouter(
        initialLocation: '/conference-listening/1',
        routes: [
          GoRoute(
            path: '/home',
            builder: (_, state) {
              homeRequest = state.extra as HomeTabRequest?;
              return const Text('home');
            },
          ),
          GoRoute(
            path: '/conference-listening/:chatId',
            builder: (_, __) => const ConferenceListeningScreen(chatId: 1, userId: 'user-1'),
          ),
        ],
      );
      addTearDown(router.dispose);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [tokenStorageProvider.overrideWithValue(tokenStorage)],
          child: MaterialApp.router(routerConfig: router),
        ),
      );
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
      await tester.pump();
      expect(find.byType(ConferenceListeningScreen), findsOneWidget);

      // The system back button: handled (not passed on to SystemNavigator.pop).
      final handled = await tester.binding.handlePopRoute();
      expect(handled, isTrue);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));

      expect(find.text('home'), findsOneWidget);
      expect(find.byType(ConferenceListeningScreen), findsNothing);
      expect(homeRequest?.tabName, kTabCallLog);
    },
  );
}
