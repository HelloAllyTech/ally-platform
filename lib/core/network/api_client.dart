import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_state.dart';
import '../config/app_config.dart';
import 'auth_interceptor.dart';

/// Equivalent of `src/services/api.ts`'s `createApi({baseQuery: ...})`: one
/// shared Dio client for the whole app, auth/versioning handled centrally
/// so individual feature API classes (ported one-by-one, matching the RN
/// app's per-domain files under `src/services/`) stay thin.
/// The server root (`--dart-define=API_BASE_URL`); a provider so tests can
/// supply one, while the app still fails fast when it's missing.
final apiBaseUrlProvider = Provider<String>((ref) => AppConfig.requireApiBaseUrl);

Dio _buildDio(String apiBaseUrl) {
  final baseUrl = '$apiBaseUrl/api';
  return Dio(
    BaseOptions(
      baseUrl: baseUrl,
      // None were set, so a stalled request spun forever. Receive is
      // generous because summary/enhance endpoints wait on an LLM; it's
      // the gap between chunks, so streamed responses aren't cut off.
      connectTimeout: const Duration(seconds: 20),
      receiveTimeout: const Duration(seconds: 90),
    ),
  );
}

/// Rebuilt whenever sign-in state changes. Nearly every data provider
/// watches its repository, and every repository watches this client, so a
/// sign-out or sign-in drops all cached account data in one place. Without
/// it, keep-alive providers (permissions, call logs, reviews...) served the
/// previous account's data to the next person to sign in on the device.
final apiClientProvider = Provider<Dio>((ref) {
  ref.watch(authControllerProvider.select((state) => state.isAuthenticated));
  final tokenStorage = ref.watch(tokenStorageProvider);
  final apiBaseUrl = ref.watch(apiBaseUrlProvider);

  // Bare client for the refresh call only — see AuthInterceptor's
  // constructor doc for why it must not carry the same interceptor.
  final refreshDio = _buildDio(apiBaseUrl);

  final dio = _buildDio(apiBaseUrl);
  dio.interceptors.add(
    AuthInterceptor(
      refreshDio: refreshDio,
      tokenStorage: tokenStorage,
      onUnrecoverable: () => ref.read(authControllerProvider.notifier).sessionExpired(),
    ),
  );
  ref.onDispose(() {
    dio.close();
    refreshDio.close();
  });
  return dio;
});
