import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/network/token_storage.dart';
import 'package:ally_mobile_flutter/core/realtime/socket_service.dart';

class MockTokenStorage extends Mock implements TokenStorage {}

// SocketService's `connect()` ends in a real `socket_io_client` `io.io(...)`
// call followed by an explicit `socket.connect()` — building a fake
// Socket.IO server (or faking socket_io_client's engine.io transport) to
// exercise that would be exactly the "fragile busywork, not real coverage"
// the task brief warns against, so none of these tests ever let execution
// reach that point. What's covered instead is the real branching logic that
// sits in front of it: the null-access-token early return and the
// `_isConnecting` idempotent-connect guard described in the class's own doc
// comment (the fix for ally-mobile's "accumulating four to seven live
// sockets" bug) — both of which run before any socket is created, and both
// of which are genuine, previously-untested logic.
//
// `disconnect()`/`emit()` are also covered for the "never connected" case,
// since both are no-ops guarded by a null check on the private `_socket`
// field — real branches, not hollow re-assertions of a mock.
void main() {
  late MockTokenStorage tokenStorage;
  late SocketService service;

  setUp(() {
    tokenStorage = MockTokenStorage();
    service = SocketService(tokenStorage);
  });

  group('connect()', () {
    test('returns without creating a socket when there is no stored access token', () async {
      when(() => tokenStorage.accessToken).thenAnswer((_) async => null);

      await service.connect(namespacePath: '/microphone-chat', userId: 'user-1');

      expect(service.isConnected, isFalse);
      verify(() => tokenStorage.accessToken).called(1);
    });

    test(
      'a second concurrent call is a no-op while the first is still resolving the token',
      () async {
        final tokenCompleter = Completer<String?>();
        when(() => tokenStorage.accessToken).thenAnswer((_) => tokenCompleter.future);

        // Starts executing synchronously up to the first `await` inside
        // connect(), which sets the `_isConnecting` guard before suspending.
        final firstCall = service.connect(namespacePath: '/microphone-chat', userId: 'user-1');

        // Re-entrant call: `_socket` is still null, but `_isConnecting` is
        // already true, so this must return immediately without touching
        // tokenStorage at all.
        await service.connect(namespacePath: '/microphone-chat', userId: 'user-1');

        // Resolve with no token so the first call also bails out before
        // ever reaching the real socket_io_client connection attempt.
        tokenCompleter.complete(null);
        await firstCall;

        verify(() => tokenStorage.accessToken).called(1);
        expect(service.isConnected, isFalse);
      },
    );

    // testWidgets for its fake clock.
    testWidgets('a failed open retries after RETRY_AFTER_FAILURE_MS (2s), until disconnect', (tester) async {
      var calls = 0;
      when(() => tokenStorage.accessToken).thenAnswer((_) async {
        calls++;
        throw Exception('keychain locked');
      });

      await service.connect(namespacePath: '/cloud-telephony-chat', userId: 'user-1');
      expect(calls, 1);

      await tester.pump(const Duration(milliseconds: 1999));
      expect(calls, 1);
      await tester.pump(const Duration(milliseconds: 1));
      expect(calls, 2, reason: 'retried once the 2s timer fired');

      service.disconnect();
      await tester.pump(const Duration(seconds: 10));
      expect(calls, 2, reason: 'disconnect cancels the retry');
    });

    test('a disconnect while the token is loading abandons that connect', () async {
      final tokenCompleter = Completer<String?>();
      when(() => tokenStorage.accessToken).thenAnswer((_) => tokenCompleter.future);

      final pending = service.connect(namespacePath: '/microphone-chat', userId: 'user-1');
      service.disconnect();
      // Had it not bailed out, a real token would reach `io.io(...)`.
      tokenCompleter.complete('token');
      await pending;

      expect(service.isConnected, isFalse);
    });

    // NOTE: the `if (_socket != null) { ... }` idempotent-reconnect branch
    // (and everything past the null-token check: the real `io.io(...)`
    // call, auth-fn token refresh, event-callback registration) can't be
    // reached without a real socket_io_client connection first — `_socket`
    // is only ever assigned after that call succeeds, and there's no fake
    // for it here (see file-level note). Untestable as written without a
    // real or fake Socket.IO server.
  });

  group('disconnect()', () {
    test('is a no-op when no connection was ever established', () {
      expect(() => service.disconnect(), returnsNormally);
      expect(service.isConnected, isFalse);
    });
  });

  group('emit()', () {
    test('is a no-op when no connection was ever established', () {
      expect(() => service.emit('AUDIO_MESSAGE', {'audio': 'abc'}), returnsNormally);
    });
  });
}
