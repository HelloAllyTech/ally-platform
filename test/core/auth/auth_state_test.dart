import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/auth/auth_state.dart';
import 'package:ally_mobile_flutter/core/network/token_storage.dart';
import 'package:ally_mobile_flutter/core/push/push_notification_service.dart';
import 'package:ally_mobile_flutter/features/notifications/data/notifications_repository.dart';

class MockTokenStorage extends Mock implements TokenStorage {}

class MockNotificationsRepository extends Mock implements NotificationsRepository {}

/// Records `unregister` calls into the shared [log] so ordering against the
/// token clear can be asserted.
class _RecordingPushService extends PushNotificationService {
  _RecordingPushService(this.log);

  final List<String> log;

  @override
  Future<void> unregister(NotificationsRepository repository) async => log.add('unregister');
}

void main() {
  // `sessionExpired()` reads `rootScaffoldMessengerKey.currentState`, which
  // needs a binding instance even just to report "no state" — these plain
  // `test()`s (no `testWidgets`/`pumpWidget`) never initialize one otherwise.
  TestWidgetsFlutterBinding.ensureInitialized();

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

  group('AuthController.logout push deregistration (RN handleUserLogout)', () {
    late List<String> log;
    late ProviderContainer pushContainer;

    setUp(() {
      log = [];
      pushContainer = ProviderContainer(
        overrides: [
          tokenStorageProvider.overrideWithValue(tokenStorage),
          pushNotificationServiceProvider.overrideWithValue(_RecordingPushService(log)),
          notificationsRepositoryProvider.overrideWithValue(MockNotificationsRepository()),
        ],
      );
      addTearDown(pushContainer.dispose);
      when(() => tokenStorage.clear()).thenAnswer((_) async => log.add('clear'));
    });

    test('deregisters the device before clearing the session', () async {
      when(() => tokenStorage.accessToken).thenAnswer((_) async => 'stored-access-token');
      pushContainer.read(authControllerProvider);
      await Future<void>.delayed(Duration.zero);

      await pushContainer.read(authControllerProvider.notifier).logout();

      expect(log, ['unregister', 'clear']);
      expect(pushContainer.read(authControllerProvider).isAuthenticated, isFalse);
    });

    test('skips deregistration when nobody is signed in', () async {
      when(() => tokenStorage.accessToken).thenAnswer((_) async => null);
      pushContainer.read(authControllerProvider);
      await Future<void>.delayed(Duration.zero);

      await pushContainer.read(authControllerProvider.notifier).logout();

      expect(log, ['clear']);
    });

    test('a 401 session expiry does not deregister (RN api.ts)', () async {
      when(() => tokenStorage.accessToken).thenAnswer((_) async => 'stored-access-token');
      pushContainer.read(authControllerProvider);
      await Future<void>.delayed(Duration.zero);

      await pushContainer.read(authControllerProvider.notifier).sessionExpired();

      expect(log, ['clear']);
    });
  });

  group('AuthController.sessionExpired', () {
    test('clears storage and flips state to unauthenticated, same as logout', () async {
      when(() => tokenStorage.accessToken).thenAnswer((_) async => 'stored-access-token');
      when(() => tokenStorage.clear()).thenAnswer((_) async {});

      container.read(authControllerProvider);
      await Future<void>.delayed(Duration.zero);
      expect(container.read(authControllerProvider).isAuthenticated, isTrue);

      // No MaterialApp/ScaffoldMessenger is mounted in this container-only
      // test, so `rootScaffoldMessengerKey.currentState` is null — the
      // snackbar call is a guarded no-op here; see
      // session_expired_snackbar_test.dart for the widget-level check that
      // it actually shows one when a ScaffoldMessenger exists.
      await container.read(authControllerProvider.notifier).sessionExpired();

      expect(container.read(authControllerProvider).isAuthenticated, isFalse);
      verify(() => tokenStorage.clear()).called(1);
    });
  });
}
