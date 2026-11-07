import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/core/localization/localization_controller.dart' show uiLanguagePrefsKey;
import 'package:ally_mobile_flutter/core/migration/legacy_session_migration.dart';
import 'package:ally_mobile_flutter/core/migration/rn_async_storage.dart';
import 'package:ally_mobile_flutter/core/network/token_storage.dart';
import 'package:ally_mobile_flutter/core/push/leaderboard_notification.dart' show leaderboardNotificationPrefsKey;

class MockTokenStorage extends Mock implements TokenStorage {}

class _FakeReader implements RnAsyncStorageReader {
  _FakeReader(this.values);

  Map<String, String>? values;
  Object? error;
  int reads = 0;
  List<String>? requestedKeys;

  @override
  Future<Map<String, String>?> read(List<String> keys) async {
    reads++;
    requestedKeys = keys;
    if (error != null) throw error!;
    return values;
  }
}

/// RN's AsyncStorage as `utils/asyncStorage.setItem` leaves it: tokens and
/// the leaderboard flag JSON-encoded, the UI language raw.
Map<String, String> _rnStore() => {
      'ACCESS_TOKEN': '"rn-access"',
      'REFRESH_TOKEN': '"rn-refresh"',
      'ally:ui:language': 'ta',
      'LEADERBOARD_NOTIFICATION_ENABLED': 'false',
    };

void main() {
  late MockTokenStorage tokens;
  late _FakeReader reader;

  LegacySessionMigrator migrator() => LegacySessionMigrator(reader: reader, tokenStorage: tokens);

  setUp(() {
    tokens = MockTokenStorage();
    when(() => tokens.accessToken).thenAnswer((_) async => null);
    when(() => tokens.storeTokens(accessToken: any(named: 'accessToken'), refreshToken: any(named: 'refreshToken')))
        .thenAnswer((_) async {});
    reader = _FakeReader(_rnStore());
    SharedPreferences.setMockInitialValues({});
  });

  test('first launch: moves the RN session and preferences, then marks itself done', () async {
    await migrator().migrateIfNeeded();

    verify(() => tokens.storeTokens(accessToken: 'rn-access', refreshToken: 'rn-refresh')).called(1);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(uiLanguagePrefsKey), 'ta');
    expect(prefs.getBool(leaderboardNotificationPrefsKey), isFalse);
    expect(prefs.getBool(LegacySessionMigrator.doneKey), isTrue);
    expect(reader.requestedKeys, RnStorageKeys.all);
  });

  test('runs once: a second launch never reads RN storage again', () async {
    await migrator().migrateIfNeeded();
    await migrator().migrateIfNeeded();

    expect(reader.reads, 1);
    verify(() => tokens.storeTokens(accessToken: any(named: 'accessToken'), refreshToken: any(named: 'refreshToken')))
        .called(1);
  });

  test('an existing Flutter session is never overwritten', () async {
    when(() => tokens.accessToken).thenAnswer((_) async => 'flutter-access');

    await migrator().migrateIfNeeded();

    verifyNever(() => tokens.storeTokens(accessToken: any(named: 'accessToken'), refreshToken: any(named: 'refreshToken')));
    expect((await SharedPreferences.getInstance()).getBool(LegacySessionMigrator.doneKey), isTrue);
  });

  test("preferences this app already has are kept", () async {
    SharedPreferences.setMockInitialValues({uiLanguagePrefsKey: 'hi', leaderboardNotificationPrefsKey: true});

    await migrator().migrateIfNeeded();

    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(uiLanguagePrefsKey), 'hi');
    expect(prefs.getBool(leaderboardNotificationPrefsKey), isTrue);
  });

  test('a half session (no refresh token) and unknown languages are not migrated', () async {
    reader.values = {'ACCESS_TOKEN': '"rn-access"', 'ally:ui:language': 'fr'};

    await migrator().migrateIfNeeded();

    verifyNever(() => tokens.storeTokens(accessToken: any(named: 'accessToken'), refreshToken: any(named: 'refreshToken')));
    expect((await SharedPreferences.getInstance()).containsKey(uiLanguagePrefsKey), isFalse);
  });

  test('no RN data (fresh install): nothing to do, still marked done', () async {
    reader.values = null;

    await migrator().migrateIfNeeded();

    verifyNever(() => tokens.storeTokens(accessToken: any(named: 'accessToken'), refreshToken: any(named: 'refreshToken')));
    expect((await SharedPreferences.getInstance()).getBool(LegacySessionMigrator.doneKey), isTrue);
  });

  test('an unreadable RN store fails quietly and is not retried', () async {
    reader.error = StateError('corrupt');

    await migrator().migrateIfNeeded();
    await migrator().migrateIfNeeded();

    expect(reader.reads, 1);
    verifyNever(() => tokens.storeTokens(accessToken: any(named: 'accessToken'), refreshToken: any(named: 'refreshToken')));
  });
}
