import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/network/token_storage.dart';

class MockFlutterSecureStorage extends Mock implements FlutterSecureStorage {}

// TokenStorage has no logic of its own beyond delegating to
// FlutterSecureStorage under fixed key names — these are smoke tests
// confirming that delegation (right method, right key, right value),
// not an attempt to exercise flutter_secure_storage itself (which needs a
// real platform channel unavailable in a plain `flutter test` run).
void main() {
  late MockFlutterSecureStorage storage;
  late TokenStorage tokenStorage;

  setUp(() {
    storage = MockFlutterSecureStorage();
    tokenStorage = TokenStorage(storage: storage);
  });

  test('accessToken reads the ACCESS_TOKEN key', () async {
    when(() => storage.read(key: 'ACCESS_TOKEN')).thenAnswer((_) async => 'the-access-token');

    expect(await tokenStorage.accessToken, 'the-access-token');
  });

  test('refreshToken reads the REFRESH_TOKEN key', () async {
    when(() => storage.read(key: 'REFRESH_TOKEN')).thenAnswer((_) async => 'the-refresh-token');

    expect(await tokenStorage.refreshToken, 'the-refresh-token');
  });

  test('storeTokens writes both keys with the given values', () async {
    when(() => storage.write(key: any(named: 'key'), value: any(named: 'value')))
        .thenAnswer((_) async {});

    await tokenStorage.storeTokens(accessToken: 'new-access', refreshToken: 'new-refresh');

    verify(() => storage.write(key: 'ACCESS_TOKEN', value: 'new-access')).called(1);
    verify(() => storage.write(key: 'REFRESH_TOKEN', value: 'new-refresh')).called(1);
  });

  test('clear deletes both keys', () async {
    when(() => storage.delete(key: any(named: 'key'))).thenAnswer((_) async {});

    await tokenStorage.clear();

    verify(() => storage.delete(key: 'ACCESS_TOKEN')).called(1);
    verify(() => storage.delete(key: 'REFRESH_TOKEN')).called(1);
  });
}
