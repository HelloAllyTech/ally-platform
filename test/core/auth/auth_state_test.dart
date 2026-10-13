import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/auth/auth_state.dart';
import 'package:ally_mobile_flutter/core/network/token_storage.dart';

class MockTokenStorage extends Mock implements TokenStorage {}

void main() {
  late MockTokenStorage tokenStorage;
  late ProviderContainer container;

  setUp(() {
    tokenStorage = MockTokenStorage();
    container = ProviderContainer(
      overrides: [tokenStorageProvider.overrideWithValue(tokenStorage)],
    );
    addTearDown(container.dispose);
  });

  group('AuthController.build (restore)', () {
    test('resolves authenticated when a token is already stored', () async {
      when(() => tokenStorage.accessToken).thenAnswer((_) async => 'stored-access-token');

      // `build()` returns the synchronous AuthState.unknown immediately and
      // kicks off `_restore()` without awaiting it, same as the real app's
      // first frame — read once to trigger build, then let the microtask
      // queue drain before asserting the restored value.
      expect(container.read(authControllerProvider).isAuthenticated, isFalse);
      await Future<void>.delayed(Duration.zero);

      expect(container.read(authControllerProvider).isAuthenticated, isTrue);
    });

    test('resolves unauthenticated when no token is stored', () async {
      when(() => tokenStorage.accessToken).thenAnswer((_) async => null);

      container.read(authControllerProvider);
      await Future<void>.delayed(Duration.zero);

      expect(container.read(authControllerProvider).isAuthenticated, isFalse);
    });

    test(
      'falls back to unauthenticated rather than throwing when storage read fails',
      () async {
        // Regression test for a real bug: a corrupted keychain / missing
        // platform plugin previously left an unhandled rejection floating
        // in the zone instead of degrading to "not authenticated".
        when(() => tokenStorage.accessToken).thenThrow(Exception('keychain unavailable'));

        expect(() => container.read(authControllerProvider), returnsNormally);
        await Future<void>.delayed(Duration.zero);

        expect(container.read(authControllerProvider).isAuthenticated, isFalse);
      },
    );
  });

  group('AuthController.signIn', () {
    test('stores both tokens and flips state to authenticated', () async {
      when(() => tokenStorage.accessToken).thenAnswer((_) async => null);
      when(
        () => tokenStorage.storeTokens(
          accessToken: any(named: 'accessToken'),
          refreshToken: any(named: 'refreshToken'),
        ),
      ).thenAnswer((_) async {});

      container.read(authControllerProvider);
      await Future<void>.delayed(Duration.zero);
      expect(container.read(authControllerProvider).isAuthenticated, isFalse);

      await container
          .read(authControllerProvider.notifier)
          .signIn(accessToken: 'new-access', refreshToken: 'new-refresh');

      expect(container.read(authControllerProvider).isAuthenticated, isTrue);
      verify(
        () => tokenStorage.storeTokens(
          accessToken: 'new-access',
          refreshToken: 'new-refresh',
        ),
      ).called(1);
    });
  });

  group('AuthController.logout', () {
    test('clears storage and flips state to unauthenticated', () async {
      when(() => tokenStorage.accessToken).thenAnswer((_) async => 'stored-access-token');
      when(() => tokenStorage.clear()).thenAnswer((_) async {});

      container.read(authControllerProvider);
      await Future<void>.delayed(Duration.zero);
      expect(container.read(authControllerProvider).isAuthenticated, isTrue);

      await container.read(authControllerProvider.notifier).logout();

      expect(container.read(authControllerProvider).isAuthenticated, isFalse);
      verify(() => tokenStorage.clear()).called(1);
    });
  });
}
