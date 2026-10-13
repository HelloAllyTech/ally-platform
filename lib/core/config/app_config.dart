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
