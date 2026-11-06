import 'dart:io';

import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../localization/localization_controller.dart' show supportedLanguageOptions, uiLanguagePrefsKey;
import '../network/token_storage.dart';
import '../push/leaderboard_notification.dart' show leaderboardNotificationPrefsKey;
import 'rn_async_storage.dart';

/// RN `src/constants/asyncStorage.ts` `AsyncStorageKeys` that this app has
/// a counterpart for. Not migrated: `LEARN_ACCESS_TOKEN` (never used by
/// RN), `I18N_VERSION` and its resource cache (re-fetched), `ACTIVE_TRACK_
/// CONTEXT` and `LEADERBOARD_NOTIF_HANDLED_TS` (transient), and
/// `AUDIO_PLAYBACK_RATE` (this app doesn't persist a playback rate).
class RnStorageKeys {
  RnStorageKeys._();

  static const accessToken = 'ACCESS_TOKEN';
  static const refreshToken = 'REFRESH_TOKEN';
  static const uiLanguage = 'ally:ui:language';
  static const leaderboardNotificationEnabled = 'LEADERBOARD_NOTIFICATION_ENABLED';

  static const all = [accessToken, refreshToken, uiLanguage, leaderboardNotificationEnabled];
}

/// One-time carry-over of the React Native app's sign-in and preferences
/// into this app's storage, so the store update (same bundle id / package)
/// doesn't sign everyone out.
///
/// Runs on the first launch only (a SharedPreferences flag, [doneKey]):
/// - Tokens move into secure storage only when this app has no session of
///   its own, and only as a pair (RN always stores both).
/// - The UI language and leaderboard-reminder flag move only when this app
///   hasn't stored its own value.
/// - RN's data is left in place, untouched (a rollback to an RN build
///   still finds it).
///
/// Never logs or reports values: every failure is swallowed silently and
/// just means the user signs in again. The flag is set even then, so a
/// broken RN store costs one attempt, not one per launch.
class LegacySessionMigrator {
  LegacySessionMigrator({required this.reader, required this.tokenStorage, Future<SharedPreferences> Function()? prefs})
      : _prefs = prefs ?? SharedPreferences.getInstance;

  final RnAsyncStorageReader reader;
  final TokenStorage tokenStorage;
  final Future<SharedPreferences> Function() _prefs;

  static const doneKey = 'rn_async_storage_migrated';

  Future<void> migrateIfNeeded() async {
    final SharedPreferences prefs;
    try {
      prefs = await _prefs();
    } catch (_) {
      return;
    }
    if (prefs.getBool(doneKey) ?? false) return;
    try {
      final values = await reader.read(RnStorageKeys.all);
      if (values != null && values.isNotEmpty) await _apply(values, prefs);
    } catch (_) {
      // Unreadable RN store: fall through to a normal sign-in.
    }
    await prefs.setBool(doneKey, true);
  }

  Future<void> _apply(Map<String, String> values, SharedPreferences prefs) async {
    final accessToken = _string(values[RnStorageKeys.accessToken]);
    final refreshToken = _string(values[RnStorageKeys.refreshToken]);
    if (accessToken != null && refreshToken != null && await tokenStorage.accessToken == null) {
      await tokenStorage.storeTokens(accessToken: accessToken, refreshToken: refreshToken);
    }

    final language = _string(values[RnStorageKeys.uiLanguage]);
    final supported = supportedLanguageOptions.map((o) => o.code);
    if (language != null && supported.contains(language) && !prefs.containsKey(uiLanguagePrefsKey)) {
      await prefs.setString(uiLanguagePrefsKey, language);
    }

    final rawLeaderboard = values[RnStorageKeys.leaderboardNotificationEnabled];
    final leaderboard = rawLeaderboard == null ? null : decodeRnValue(rawLeaderboard);
    if (leaderboard is bool && !prefs.containsKey(leaderboardNotificationPrefsKey)) {
      await prefs.setBool(leaderboardNotificationPrefsKey, leaderboard);
    }
  }

  /// A non-empty string value, JSON-encoded (`setItem`) or raw.
  static String? _string(String? raw) {
    if (raw == null) return null;
    final decoded = decodeRnValue(raw);
    final value = decoded is String ? decoded : null;
    return (value == null || value.isEmpty) ? null : value;
  }
}

/// Runs the migration for this platform. Called from `main()` before
/// `runApp`, so the session and language are in place before the router
/// and the localization controller first read them. Prod flavor only: only
/// the store identity can find RN's data.
Future<void> migrateFromReactNativeApp(TokenStorage tokenStorage) async {
  try {
    final RnAsyncStorageReader reader;
    if (Platform.isIOS) {
      final support = await getApplicationSupportDirectory();
      final bundleId = (await PackageInfo.fromPlatform()).packageName;
      reader = IosRnAsyncStorageReader(
        IosRnAsyncStorageReader.directoryFor(applicationSupportPath: support.path, bundleId: bundleId),
      );
    } else if (Platform.isAndroid) {
      reader = AndroidRnAsyncStorageReader();
    } else {
      return;
    }
    await LegacySessionMigrator(reader: reader, tokenStorage: tokenStorage).migrateIfNeeded();
  } catch (_) {
    // Never block launch on the migration.
  }
}
