import 'package:ally_mobile_flutter/core/auth/auth_state.dart';
import 'package:ally_mobile_flutter/core/network/api_client.dart';
import 'package:ally_mobile_flutter/core/network/retry_policy.dart';
import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeAuthController extends AuthController {
  @override
  AuthState build() => const AuthState(isAuthenticated: true);

  void set(bool value) => state = AuthState(isAuthenticated: value);
}

/// Stands in for the real repository but reads the client the same way
/// (`ref.watch(apiClientProvider)` in its provider), so it is rebuilt when
/// the client is.
class _CountingRepository extends PermissionsRepository {
  _CountingRepository(super.dio, this.answers);

  final List<List<String>> answers;
  static int calls = 0;

  @override
  Future<List<String>> getPermissions() async => answers[calls++];
}

DioException _dioError(int? status, {DioExceptionType type = DioExceptionType.badResponse}) {
  final options = RequestOptions(path: '/x');
  return DioException(
    requestOptions: options,
    type: type,
    response: status == null ? null : Response<void>(requestOptions: options, statusCode: status),
  );
}

void main() {
  group('appRetryPolicy', () {
    test('never retries a 4xx (it cannot heal)', () {
      expect(appRetryPolicy(0, _dioError(401)), isNull);
      expect(appRetryPolicy(0, _dioError(403)), isNull);
      expect(appRetryPolicy(0, _dioError(404)), isNull);
    });

    test('retries 5xx and network failures with backoff, at most 3 times', () {
      expect(appRetryPolicy(0, _dioError(503)), const Duration(milliseconds: 400));
      expect(appRetryPolicy(1, _dioError(null, type: DioExceptionType.connectionError)),
          const Duration(milliseconds: 800));
      expect(appRetryPolicy(3, _dioError(503)), isNull);
    });

    test('does not retry cancellations or programming errors', () {
      expect(appRetryPolicy(0, _dioError(null, type: DioExceptionType.cancel)), isNull);
      expect(appRetryPolicy(0, StateError('bug')), isNull);
    });
  });

  test("a new sign-in drops the previous account's cached data", () async {
    _CountingRepository.calls = 0;
    final auth = _FakeAuthController();
    final container = ProviderContainer(
      overrides: [
        authControllerProvider.overrideWith(() => auth),
        apiBaseUrlProvider.overrideWithValue('http://localhost:8001'),
        permissionsRepositoryProvider.overrideWith(
          (ref) => _CountingRepository(ref.watch(apiClientProvider), [
            ['view:call:logs'], // account A
            ['view:simulation-reviews'], // account B
          ]),
        ),
      ],
    );
    addTearDown(container.dispose);
    container.listen(userPermissionsProvider, (_, _) {});

    expect(await container.read(userPermissionsProvider.future), ['view:call:logs']);

    auth.set(false); // A signs out
    auth.set(true); // B signs in
    expect(await container.read(userPermissionsProvider.future), ['view:simulation-reviews']);
  });
}
