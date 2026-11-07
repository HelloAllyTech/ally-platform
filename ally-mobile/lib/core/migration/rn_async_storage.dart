import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter/services.dart';

/// Read-only access to the AsyncStorage of the React Native app this build
/// replaces (`@react-native-async-storage/async-storage` 2.x, which RN's
/// `ally-mobile` uses with its default, non-"next" storage). Used once, by
/// `LegacySessionMigrator`, on the first launch after the store update.
abstract class RnAsyncStorageReader {
  /// The stored raw strings for whichever of [keys] exist, or `null` when RN
  /// never stored anything on this install.
  Future<Map<String, String>?> read(List<String> keys);
}

/// iOS: `Library/Application Support/<bundle id>/RCTAsyncLocalStorage_V1/`.
/// `manifest.json` maps each key to its value, or to `null` when the value
/// is over 1024 characters and lives in its own file in the same directory,
/// named by the MD5 hex of the key (`RNCAsyncStorage.mm` `_getValueForKey`,
/// `RCTMD5Hash`).
class IosRnAsyncStorageReader implements RnAsyncStorageReader {
  IosRnAsyncStorageReader(this.storageDirectory);

  /// `<Application Support>/<bundle id>/RCTAsyncLocalStorage_V1`.
  final Directory storageDirectory;

  /// The directory for [bundleId] under [applicationSupportPath] (what
  /// `path_provider`'s `getApplicationSupportDirectory` returns on iOS).
  static Directory directoryFor({required String applicationSupportPath, required String bundleId}) =>
      Directory('$applicationSupportPath/$bundleId/RCTAsyncLocalStorage_V1');

  @override
  Future<Map<String, String>?> read(List<String> keys) async {
    final manifestFile = File('${storageDirectory.path}/manifest.json');
    if (!await manifestFile.exists()) return null;
    final manifest = jsonDecode(await manifestFile.readAsString());
    if (manifest is! Map) return null;
    final values = <String, String>{};
    for (final key in keys) {
      if (!manifest.containsKey(key)) continue;
      final inline = manifest[key];
      if (inline is String) {
        values[key] = inline;
        continue;
      }
      // null: the value was too long to inline.
      final overflow = File('${storageDirectory.path}/${overflowFileName(key)}');
      if (await overflow.exists()) values[key] = await overflow.readAsString();
    }
    return values;
  }

  /// RN's `RCTMD5Hash(key)`: lowercase hex MD5 of the UTF-8 key.
  static String overflowFileName(String key) => md5.convert(utf8.encode(key)).toString();
}

/// Android: SQLite database `RKStorage`, table `catalystLocalStorage(key,
/// value)`, read natively by `MainActivity`'s `ally/legacy_rn_storage`
/// channel (no SQLite plugin needed for one query).
class AndroidRnAsyncStorageReader implements RnAsyncStorageReader {
  AndroidRnAsyncStorageReader({MethodChannel? channel})
      : _channel = channel ?? const MethodChannel('ally/legacy_rn_storage');

  final MethodChannel _channel;

  @override
  Future<Map<String, String>?> read(List<String> keys) async {
    final rows = await _channel.invokeMapMethod<String, String>('readAsyncStorage', {'keys': keys});
    return rows;
  }
}

/// RN's `utils/asyncStorage.setItem` stores `JSON.stringify(value)`, so a
/// token reads back as `"eyJ…"` with quotes; a few keys (the UI language)
/// are written raw with `AsyncStorage.setItem`. Returns the JSON-decoded
/// value when [raw] is JSON, else [raw] itself.
Object? decodeRnValue(String raw) {
  try {
    return jsonDecode(raw);
  } on FormatException {
    return raw;
  }
}
