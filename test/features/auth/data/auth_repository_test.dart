import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/network/api_routes.dart';
import 'package:ally_mobile_flutter/features/auth/data/auth_repository.dart';

class MockDio extends Mock implements Dio {}

// Mirrors the private `_allowedRoles` constant in auth_repository.dart —
// every one of generateOtp/verifyOtp/loginWithGoogle/loginWithApple must
// send exactly this list.
const _allowedRoles = [
  'COUNSELOR',
  'LEARNER',
  'SIMULATION_REVIEWER',
  'SCRIBE_REVIEWER',
  'EVALUATOR',
];

Response<T> _response<T>(T? data, {int statusCode = 200}) => Response<T>(
      data: data,
      statusCode: statusCode,
      requestOptions: RequestOptions(path: ''),
    );

void main() {
  late MockDio dio;
  late AuthRepository repository;

  setUp(() {
    dio = MockDio();
    repository = AuthRepository(dio);
  });

  group('generateOtp', () {
    test('posts email + allowedRoles + appType and returns the expiresIn seconds', () async {
      when(() => dio.post<Map<String, dynamic>>(
            ApiRoutes.authGenerateOtp,
            data: {'email': 'a@b.com', 'allowedRoles': _allowedRoles, 'appType': 'APP'},
          )).thenAnswer((_) async => _response({'success': true, 'expiresIn': 600}));

      final expiresIn = await repository.generateOtp('a@b.com');

      expect(expiresIn, 600);
      verify(() => dio.post<Map<String, dynamic>>(
            ApiRoutes.authGenerateOtp,
            data: {'email': 'a@b.com', 'allowedRoles': _allowedRoles, 'appType': 'APP'},
          )).called(1);
    });

    test('returns null when the response omits expiresIn', () async {
      when(() => dio.post<Map<String, dynamic>>(
            ApiRoutes.authGenerateOtp,
            data: {'email': 'a@b.com', 'allowedRoles': _allowedRoles, 'appType': 'APP'},
          )).thenAnswer((_) async => _response({'success': true}));

      expect(await repository.generateOtp('a@b.com'), isNull);
    });
  });

  group('verifyOtp', () {
    test('posts email/otp/allowedRoles and returns the token pair', () async {
      when(() => dio.post<Map<String, dynamic>>(
            ApiRoutes.authVerifyOtp,
            data: {'email': 'a@b.com', 'otp': '123456', 'allowedRoles': _allowedRoles},
          )).thenAnswer((_) async => _response({
            'accessToken': 'access-1',
            'refreshToken': 'refresh-1',
          }));

      final (accessToken, refreshToken) =
          await repository.verifyOtp(email: 'a@b.com', otp: '123456');

      expect(accessToken, 'access-1');
      expect(refreshToken, 'refresh-1');
      verify(() => dio.post<Map<String, dynamic>>(
            ApiRoutes.authVerifyOtp,
            data: {'email': 'a@b.com', 'otp': '123456', 'allowedRoles': _allowedRoles},
          )).called(1);
    });
  });

  group('loginWithGoogle', () {
    test('posts idToken + allowedRoles and returns the token pair', () async {
      when(() => dio.post<Map<String, dynamic>>(
            ApiRoutes.authGoogleLogin,
            data: {'idToken': 'google-id-token', 'allowedRoles': _allowedRoles},
          )).thenAnswer((_) async => _response({
            'accessToken': 'access-2',
            'refreshToken': 'refresh-2',
          }));

      final (accessToken, refreshToken) = await repository.loginWithGoogle('google-id-token');

      expect(accessToken, 'access-2');
      expect(refreshToken, 'refresh-2');
      verify(() => dio.post<Map<String, dynamic>>(
            ApiRoutes.authGoogleLogin,
            data: {'idToken': 'google-id-token', 'allowedRoles': _allowedRoles},
          )).called(1);
    });
  });

  group('loginWithApple', () {
    test('identityToken only omits authorizationCode and fullName entirely', () async {
      when(() => dio.post<Map<String, dynamic>>(
            ApiRoutes.authAppleLogin,
            data: {'identityToken': 'id-token', 'allowedRoles': _allowedRoles},
          )).thenAnswer((_) async => _response({
            'accessToken': 'access-3',
            'refreshToken': 'refresh-3',
          }));

      final (accessToken, refreshToken) =
          await repository.loginWithApple(identityToken: 'id-token');

      expect(accessToken, 'access-3');
      expect(refreshToken, 'refresh-3');
      verify(() => dio.post<Map<String, dynamic>>(
            ApiRoutes.authAppleLogin,
            data: {'identityToken': 'id-token', 'allowedRoles': _allowedRoles},
          )).called(1);
    });

    test('includes authorizationCode when provided, still omits fullName', () async {
      when(() => dio.post<Map<String, dynamic>>(
            ApiRoutes.authAppleLogin,
            data: {
              'identityToken': 'id-token',
              'authorizationCode': 'auth-code',
              'allowedRoles': _allowedRoles,
            },
          )).thenAnswer((_) async => _response({
            'accessToken': 'access-4',
            'refreshToken': 'refresh-4',
          }));

      await repository.loginWithApple(
        identityToken: 'id-token',
        authorizationCode: 'auth-code',
      );

      verify(() => dio.post<Map<String, dynamic>>(
            ApiRoutes.authAppleLogin,
            data: {
              'identityToken': 'id-token',
              'authorizationCode': 'auth-code',
              'allowedRoles': _allowedRoles,
            },
          )).called(1);
    });

    test('includes a partial fullName when only givenName is provided', () async {
      when(() => dio.post<Map<String, dynamic>>(
            ApiRoutes.authAppleLogin,
            data: {
              'identityToken': 'id-token',
              'fullName': {'givenName': 'Ada'},
              'allowedRoles': _allowedRoles,
            },
          )).thenAnswer((_) async => _response({
            'accessToken': 'access-5',
            'refreshToken': 'refresh-5',
          }));

      await repository.loginWithApple(identityToken: 'id-token', givenName: 'Ada');

      verify(() => dio.post<Map<String, dynamic>>(
            ApiRoutes.authAppleLogin,
            data: {
              'identityToken': 'id-token',
              'fullName': {'givenName': 'Ada'},
              'allowedRoles': _allowedRoles,
            },
          )).called(1);
    });

    test('includes authorizationCode and a full fullName when everything is provided', () async {
      when(() => dio.post<Map<String, dynamic>>(
            ApiRoutes.authAppleLogin,
            data: {
              'identityToken': 'id-token',
              'authorizationCode': 'auth-code',
              'fullName': {'givenName': 'Ada', 'familyName': 'Lovelace'},
              'allowedRoles': _allowedRoles,
            },
          )).thenAnswer((_) async => _response({
            'accessToken': 'access-6',
            'refreshToken': 'refresh-6',
          }));

      await repository.loginWithApple(
        identityToken: 'id-token',
        authorizationCode: 'auth-code',
        givenName: 'Ada',
        familyName: 'Lovelace',
      );

      verify(() => dio.post<Map<String, dynamic>>(
            ApiRoutes.authAppleLogin,
            data: {
              'identityToken': 'id-token',
              'authorizationCode': 'auth-code',
              'fullName': {'givenName': 'Ada', 'familyName': 'Lovelace'},
              'allowedRoles': _allowedRoles,
            },
          )).called(1);
    });
  });
}
