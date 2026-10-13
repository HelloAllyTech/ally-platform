import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_routes.dart';

/// Mirrors ally-mobile (React Native)'s `src/constants/general.ts`
/// `ALLOWED_ROLES` — exactly which roles this client is allowed to sign in
/// as. Keep in sync with that file.
const _allowedRoles = [
  'COUNSELOR',
  'LEARNER',
  'SIMULATION_REVIEWER',
  'SCRIBE_REVIEWER',
  'EVALUATOR',
];

/// Ported from ally-mobile (React Native)'s `src/services/authApi.ts` —
/// email+OTP only. Google/Apple sign-in aren't ported: they need native
/// OAuth client configuration (SHA-1 fingerprint, bundle ID) registered
/// against this app's own distinct package name/bundle ID before they'd
/// work at all, which is Google Cloud/Apple Developer Portal setup, not
/// something fixable in code alone. OTP needs none of that — plain REST
/// calls — so it's the fast path to a real, backend-accepted session for
/// testing every other screen.
class AuthRepository {
  AuthRepository(this._dio);

  final Dio _dio;

  Future<void> generateOtp(String email) async {
    await _dio.post<void>(
      ApiRoutes.authGenerateOtp,
      data: {'email': email, 'allowedRoles': _allowedRoles, 'appType': 'APP'},
    );
  }

  /// Returns the real accessToken/refreshToken pair on success.
  Future<(String accessToken, String refreshToken)> verifyOtp({
    required String email,
    required String otp,
  }) async {
    final response = await _dio.post<Map<String, dynamic>>(
      ApiRoutes.authVerifyOtp,
      data: {'email': email, 'otp': otp, 'allowedRoles': _allowedRoles},
    );
    return (
      response.data!['accessToken'] as String,
      response.data!['refreshToken'] as String,
    );
  }
}

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository(ref.watch(apiClientProvider));
});
