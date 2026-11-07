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

/// Ported from ally-mobile (React Native)'s `src/services/authApi.ts`.
/// Email+OTP, Google, and Apple all hit the same real backend contract.
///
/// Google/Apple sign-in still can't complete an actual round-trip on a
/// released build of this app until its own distinct package name/bundle ID
/// has an OAuth client registered (SHA-1 fingerprint for Android, bundle ID
/// for iOS) in Google Cloud/Apple Developer Portal — that's console setup,
/// not something fixable in code. `AppConfig.googleWebClientId` being empty
/// is how the login screen detects that and disables the button rather
/// than launching a flow that can only fail. OTP needs none of that —
/// plain REST calls — so it remains the fast path to a real session for
/// testing every other screen in the meantime.
class AuthRepository {
  AuthRepository(this._dio);

  final Dio _dio;

  /// Returns the OTP's real server-side expiry in seconds, when the backend
  /// sends one — RN's `GenerateOtpResponse.expiresIn`, used to show "this
  /// code expires in N minutes" rather than always assuming the default.
  Future<int?> generateOtp(String email) async {
    final response = await _dio.post<Map<String, dynamic>>(
      ApiRoutes.authGenerateOtp,
      data: {'email': email, 'allowedRoles': _allowedRoles, 'appType': 'APP'},
    );
    return (response.data?['expiresIn'] as num?)?.toInt();
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

  Future<(String accessToken, String refreshToken)> loginWithGoogle(String idToken) async {
    final response = await _dio.post<Map<String, dynamic>>(
      ApiRoutes.authGoogleLogin,
      data: {'idToken': idToken, 'allowedRoles': _allowedRoles},
    );
    return (
      response.data!['accessToken'] as String,
      response.data!['refreshToken'] as String,
    );
  }

  Future<(String accessToken, String refreshToken)> loginWithApple({
    required String identityToken,
    String? authorizationCode,
    String? givenName,
    String? familyName,
  }) async {
    final response = await _dio.post<Map<String, dynamic>>(
      ApiRoutes.authAppleLogin,
      data: {
        'identityToken': identityToken,
        'authorizationCode': ?authorizationCode,
        if (givenName != null || familyName != null)
          'fullName': {
            'givenName': ?givenName,
            'familyName': ?familyName,
          },
        'allowedRoles': _allowedRoles,
      },
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
