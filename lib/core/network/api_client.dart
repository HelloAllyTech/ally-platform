import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_state.dart';
import '../config/app_config.dart';
import 'auth_interceptor.dart';

/// Equivalent of `src/services/api.ts`'s `createApi({baseQuery: ...})`: one
/// shared Dio client for the whole app, auth/versioning handled centrally
/// so individual feature API classes (ported one-by-one, matching the RN
/// app's per-domain files under `src/services/`) stay thin.
Dio _buildDio() {
  final baseUrl = '${AppConfig.requireApiBaseUrl}/api';
  return Dio(BaseOptions(baseUrl: baseUrl));
}

final apiClientProvider = Provider<Dio>((ref) {
  final tokenStorage = ref.watch(tokenStorageProvider);

  // Bare client for the refresh call only — see AuthInterceptor's
  // constructor doc for why it must not carry the same interceptor.
  final refreshDio = _buildDio();

  final dio = _buildDio();
  dio.interceptors.add(
    AuthInterceptor(
      refreshDio: refreshDio,
      tokenStorage: tokenStorage,
      onUnrecoverable: () => ref.read(authControllerProvider.notifier).sessionExpired(),
    ),
  );
  return dio;
});
