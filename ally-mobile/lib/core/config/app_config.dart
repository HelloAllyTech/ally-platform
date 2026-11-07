import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter/services.dart' show appFlavor;

/// Mirrors ally-mobile (React Native)'s `src/config/env.ts`: fail fast on a
/// missing required value rather than silently falling back to a wrong
/// environment, since that's exactly the class of bug env.ts's
/// `assertEnvVar` exists to prevent.
///
/// Values are supplied via `--dart-define-from-file` at build time (the
/// Flutter equivalent of `react-native-config`'s `.env` file), not read from
/// a checked-in file. Release CI writes RN's own `ENV_VALUES_*` secret to
/// `.env` and passes it as-is (Flutter reads `.env` syntax); see
/// docs/RELEASE.md.
class AppConfig {
  AppConfig._();

  /// The build flavor (`dev` | `prod`), from `--flavor` (pubspec's
  /// `default-flavor` is `dev`). `prod` is the store app with RN's identity.
  static const String? flavor = appFlavor;

  static const bool isProdFlavor = appFlavor == 'prod';

  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: '',
  );

  /// Mirrors `env.ALLY_WEB_URL` — the web app's origin, with a trailing
  /// slash as RN's env files have it (SimulationDetails copies
  /// `${ALLY_WEB_URL}scenario/<id>`). RN requires it; this defaults to the
  /// production web app so an unconfigured build still copies working links.
  static const String allyWebUrl = String.fromEnvironment(
    'ALLY_WEB_URL',
    defaultValue: 'https://app.helloally.ai/',
  );

  /// Mirrors `env.MICROPHONE_SOCKET_PATH` — the Socket.IO namespace Scribe's
  /// live recording connects to (ally-be's CLAUDE.md lists it as
  /// `/microphone-chat`), configurable rather than hardcoded for the same
  /// reason the RN app keeps it in env rather than a constant.
  static const String microphoneSocketPath = String.fromEnvironment(
    'MICROPHONE_SOCKET_PATH',
    defaultValue: '/microphone-chat',
  );

  /// Mirrors `env.CLOUD_TELEPHONY_PATH` — the Socket.IO namespace a
  /// cloud-telephony (Exotel/Ozonetel) conference call connects to, used by
  /// `ConferenceListeningScreen` instead of [microphoneSocketPath].
  static const String cloudTelephonyPath = String.fromEnvironment(
    'CLOUD_TELEPHONY_PATH',
    defaultValue: '/cloud-telephony-chat',
  );

  /// Mirrors `env.I18N_BASE_URL` — the dynamic translation CDN this app's
  /// real counterpart polls at runtime (manifest.json + per-namespace JSON),
  /// with the bundled locale assets as the offline/zero-delay fallback only.
  ///
  /// An unset or empty define falls back to the flavor default: production's
  /// translation server for `prod` (`https://api.helloally.ai/i18n`, which
  /// serves the live `manifest.json`; RN's production value lives only in
  /// its ENV_VALUES_PRODUCTION secret), the old default otherwise.
  static const String i18nBaseUrl = _i18nBaseUrlDefine != ''
      ? _i18nBaseUrlDefine
      : (isProdFlavor ? 'https://api.helloally.ai/i18n' : 'https://api.helloally.dev/i18n');

  static const String _i18nBaseUrlDefine = String.fromEnvironment('I18N_BASE_URL');

  /// Mirrors `env.LANGUAGE_SELECTOR_FLAG` — gates the dynamic translation
  /// sync and Profile Settings' Language row, as in RN. Defaults to RN
  /// production's value (`true`); `--dart-define=LANGUAGE_SELECTOR_FLAG=false`
  /// turns both off.
  static const bool languageSelectorEnabled = bool.fromEnvironment(
    'LANGUAGE_SELECTOR_FLAG',
    defaultValue: true,
  );

  /// Mirrors `Config.GOOGLE_WEB_CLIENT_ID` — used as `serverClientId` so the
  /// ID token's audience is the one ally-be's `/auth/google` verifies
  /// against (the same value regardless of platform, same as the RN app).
  /// Empty until this app's own distinct package name has an OAuth client
  /// registered in Google Cloud Console — see `auth_repository.dart`.
  static const String googleWebClientId = String.fromEnvironment(
    'GOOGLE_WEB_CLIENT_ID',
    defaultValue: '',
  );

  /// Mirrors `Config.GOOGLE_IOS_CLIENT_ID` — the iOS-platform OAuth client,
  /// passed as `clientId` (Android has no equivalent; it resolves its
  /// client config from `google-services.json` instead).
  static const String googleIosClientId = String.fromEnvironment(
    'GOOGLE_IOS_CLIENT_ID',
    defaultValue: '',
  );

  static String get requireApiBaseUrl {
    if (apiBaseUrl.isEmpty) {
      throw StateError(
        'API_BASE_URL is not set. Pass --dart-define=API_BASE_URL=... '
        '(or --dart-define-from-file) when running/building.',
      );
    }
    return apiBaseUrl;
  }

  /// Mirrors `env.ENVIRONMENT` (`development` | `staging` | `production`).
  /// The drawer appends `drawer.dev` ("(Dev)") to the version when this is
  /// `development`, like RN's `CustomDrawerContent`. Debug builds default to
  /// `development` so a local run reads like RN's dev build; release builds
  /// must pass `--dart-define=ENVIRONMENT=...` to say otherwise. A `dev`
  /// flavor release build also defaults to `development` (it is never the
  /// store app).
  static const String environment = String.fromEnvironment(
    'ENVIRONMENT',
    defaultValue: (kDebugMode || appFlavor == 'dev') ? 'development' : 'production',
  );
}
