import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/migration/rn_async_storage.dart';

/// Fixtures mirror what `@react-native-async-storage/async-storage` 2.x
/// writes: iOS `manifest.json` (+ MD5-named overflow files for values over
/// 1024 characters), Android `catalystLocalStorage` rows.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('IosRnAsyncStorageReader', () {
    late Directory root;
    late Directory storage;

    setUp(() async {
      root = await Directory.systemTemp.createTemp('rn_async_storage');
      storage = IosRnAsyncStorageReader.directoryFor(applicationSupportPath: root.path, bundleId: 'com.helloally.app');
    });

    tearDown(() => root.delete(recursive: true));

    test('lives under Application Support/<bundle id>/RCTAsyncLocalStorage_V1', () {
      expect(storage.path, '${root.path}/com.helloally.app/RCTAsyncLocalStorage_V1');
    });

    test('no manifest: RN never ran here', () async {
      expect(await IosRnAsyncStorageReader(storage).read(['ACCESS_TOKEN']), isNull);
    });

    test('reads inline values and overflow files, skips missing keys', () async {
      final longToken = '"${'a' * 1500}"';
      await storage.create(recursive: true);
      await File('${storage.path}/manifest.json').writeAsString(jsonEncode({
        'ACCESS_TOKEN': null, // too long to inline: stored in its own file
        'REFRESH_TOKEN': '"refresh-value"',
        'ally:ui:language': 'hi',
        'LEADERBOARD_NOTIFICATION_ENABLED': 'false',
        'UNRELATED': '"x"',
      }));
      await File('${storage.path}/${IosRnAsyncStorageReader.overflowFileName('ACCESS_TOKEN')}').writeAsString(longToken);

      final values = await IosRnAsyncStorageReader(storage)
          .read(['ACCESS_TOKEN', 'REFRESH_TOKEN', 'ally:ui:language', 'LEADERBOARD_NOTIFICATION_ENABLED', 'MISSING']);

      expect(values, {
        'ACCESS_TOKEN': longToken,
        'REFRESH_TOKEN': '"refresh-value"',
        'ally:ui:language': 'hi',
        'LEADERBOARD_NOTIFICATION_ENABLED': 'false',
      });
    });

    test('a null manifest entry whose file is gone is skipped', () async {
      await storage.create(recursive: true);
      await File('${storage.path}/manifest.json').writeAsString(jsonEncode({'ACCESS_TOKEN': null}));
      expect(await IosRnAsyncStorageReader(storage).read(['ACCESS_TOKEN']), isEmpty);
    });

    test('overflow file name is RCTMD5Hash: lowercase hex MD5 of the key', () {
      expect(IosRnAsyncStorageReader.overflowFileName('ACCESS_TOKEN'), matches(RegExp(r'^[0-9a-f]{32}$')));
      expect(IosRnAsyncStorageReader.overflowFileName('abc'), '900150983cd24fb0d6963f7d28e17f72');
    });
  });

  group('AndroidRnAsyncStorageReader', () {
    const channel = MethodChannel('ally/legacy_rn_storage');

    tearDown(() => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, null));

    test('asks MainActivity for exactly the wanted keys and returns its rows', () async {
      MethodCall? received;
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, (call) async {
        received = call;
        return {'ACCESS_TOKEN': '"a"', 'REFRESH_TOKEN': '"r"'};
      });

      final values = await AndroidRnAsyncStorageReader().read(['ACCESS_TOKEN', 'REFRESH_TOKEN']);

      expect(received?.method, 'readAsyncStorage');
      expect(received?.arguments, {
        'keys': ['ACCESS_TOKEN', 'REFRESH_TOKEN'],
      });
      expect(values, {'ACCESS_TOKEN': '"a"', 'REFRESH_TOKEN': '"r"'});
    });

    test('no RKStorage database: null', () async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, (call) async => null);
      expect(await AndroidRnAsyncStorageReader().read(['ACCESS_TOKEN']), isNull);
    });
  });

  group('decodeRnValue', () {
    test('JSON.stringify values decode; raw strings pass through', () {
      expect(decodeRnValue('"token"'), 'token');
      expect(decodeRnValue('true'), true);
      expect(decodeRnValue('hi'), 'hi');
    });
  });
}
