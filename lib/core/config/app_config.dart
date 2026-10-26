/// Mirrors ally-mobile (React Native)'s `src/config/env.ts`: fail fast on a
/// missing required value rather than silently falling back to a wrong
/// environment, since that's exactly the class of bug env.ts's
/// `assertEnvVar` exists to prevent.
///
/// Values are supplied via `--dart-define-from-file` at build time (the
/// Flutter equivalent of `react-native-config`'s `.env` file), not read from
/// a checked-in file — see `README.md` in this directory once build flavors
/// are wired up in Phase 0's CI port.
class AppConfig {
  AppConfig._();

  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: '',
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
  static const String i18nBaseUrl = String.fromEnvironment(
    'I18N_BASE_URL',
    defaultValue: 'https://api.helloally.dev/i18n',
  );

  /// Mirrors `env.LANGUAGE_SELECTOR_FLAG` — gates the dynamic sync exactly
  /// like the RN app does, defaulting off until explicitly enabled.
  static const bool languageSelectorEnabled = bool.fromEnvironment(
    'LANGUAGE_SELECTOR_FLAG',
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
}
