import 'package:ally_mobile_flutter/core/auth/auth_state.dart';
import 'package:ally_mobile_flutter/core/localization/localization_controller.dart';
import 'package:ally_mobile_flutter/core/network/token_storage.dart';
import 'package:ally_mobile_flutter/core/widgets/root_scaffold_messenger.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import '../../support/fake_translations.dart';

class MockTokenStorage extends Mock implements TokenStorage {}

/// `AuthController.sessionExpired()`'s snackbar only shows when a real
/// `ScaffoldMessenger` is mounted at `rootScaffoldMessengerKey` — the
/// `auth_state_test.dart` container-only tests can't see this (no
/// MaterialApp, so `currentState` is null there), so it gets this one
/// dedicated widget test instead.
void main() {
  testWidgets(
    'shows the real translated session-expired message via the root ScaffoldMessenger',
    (tester) async {
      final tokenStorage = MockTokenStorage();
      when(() => tokenStorage.accessToken).thenAnswer((_) async => 'stored-access-token');
      when(() => tokenStorage.clear()).thenAnswer((_) async {});

      final container = ProviderContainer(
        overrides: [
          tokenStorageProvider.overrideWithValue(tokenStorage),
          fixedTranslationsOverride(),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(
            scaffoldMessengerKey: rootScaffoldMessengerKey,
            home: const Scaffold(body: SizedBox.shrink()),
          ),
        ),
      );
      await tester.pumpAndSettle();
      // Nothing in the widget tree watches `localizationControllerProvider`
      // (there's no `ref.t()` call anywhere above), so it's never actually
      // started yet — `sessionExpired()`'s `ref.read(...).value` would hit
      // it mid-`AsyncLoading` otherwise, even with `fixedTranslationsOverride`,
      // since that override's `build()` is still `async` under the hood.
      await container.read(localizationControllerProvider.future);
      // Signed in: let `_restore()` pick up the stored token first, as it
      // always has by the time a real request could 401.
      container.read(authControllerProvider);
      await tester.pump();
      expect(container.read(authControllerProvider).isAuthenticated, isTrue);

      await container.read(authControllerProvider.notifier).sessionExpired();
      // The snackbar enters via an animation — a zero-duration pump() alone
      // leaves it still transitioning in, not yet matched by find.text().
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 750));

      expect(find.text('Your session has expired. Please sign in again.'), findsOneWidget);
    },
  );

  testWidgets(
    'shows no snackbar when nobody was signed in — there was no session to expire',
    (tester) async {
      final tokenStorage = MockTokenStorage();
      when(() => tokenStorage.accessToken).thenAnswer((_) async => null);
      when(() => tokenStorage.clear()).thenAnswer((_) async {});

      final container = ProviderContainer(
        overrides: [
          tokenStorageProvider.overrideWithValue(tokenStorage),
          fixedTranslationsOverride(),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(
            scaffoldMessengerKey: rootScaffoldMessengerKey,
            home: const Scaffold(body: SizedBox.shrink()),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await container.read(localizationControllerProvider.future);
      container.read(authControllerProvider);
      await tester.pump();
      expect(container.read(authControllerProvider).isAuthenticated, isFalse);

      final message = await container.read(authControllerProvider.notifier).sessionExpired();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 750));

      // The interceptor still gets the message for its replaced error.
      expect(message, 'Your session has expired. Please sign in again.');
      expect(find.byType(SnackBar), findsNothing);
    },
  );
}
