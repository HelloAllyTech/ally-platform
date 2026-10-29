import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/auth/auth_state.dart';
import 'package:ally_mobile_flutter/features/account/data/account_repository.dart';

class MockDio extends Mock implements Dio {}

class _FakeAuthController extends AuthController {
  _FakeAuthController({required this.isAuthenticated});

  final bool isAuthenticated;

  @override
  AuthState build() => AuthState(isAuthenticated: isAuthenticated);

  void setAuthenticated(bool value) => state = AuthState(isAuthenticated: value);
}

Response<T> _response<T>(T? data, {int statusCode = 200}) => Response<T>(
      data: data,
      statusCode: statusCode,
      requestOptions: RequestOptions(path: ''),
    );

void main() {
  late MockDio dio;
  late AccountRepository repository;

  setUp(() {
    dio = MockDio();
    repository = AccountRepository(dio);
  });

  group('getUser', () {
    test('parses the current user from /users/me', () async {
      when(() => dio.get<Map<String, dynamic>>('/users/me')).thenAnswer(
        (_) async => _response({
          'id': 7,
          'email': 'jane@example.com',
          'name': 'Jane',
          'phone': '',
          'profileImageUrl': null,
          'profileCompleted': true,
        }),
      );

      final user = await repository.getUser();

      expect(user.id, 7);
      expect(user.name, 'Jane');
      expect(user.profileCompleted, isTrue);
    });
  });

  group('getTenant', () {
    test('parses the signed-in org from /users/tenant', () async {
      when(() => dio.get<Map<String, dynamic>>('/users/tenant')).thenAnswer(
        (_) async => _response({'name': 'Acme Health', 'logoUrl': 'https://cdn.example.com/logo.png'}),
      );

      final tenant = await repository.getTenant();

      expect(tenant.name, 'Acme Health');
      expect(tenant.logoUrl, 'https://cdn.example.com/logo.png');
    });
  });

  group('completeProfile', () {
    test('patches name only when phone is omitted', () async {
      when(
        () => dio.patch<void>(
          '/users/me/complete-profile',
          data: {'name': 'Jane'},
        ),
      ).thenAnswer((_) async => _response<void>(null));

      await repository.completeProfile(name: 'Jane');

      verify(
        () => dio.patch<void>(
          '/users/me/complete-profile',
          data: {'name': 'Jane'},
        ),
      ).called(1);
    });

    test('patches both name and phone when phone is provided', () async {
      when(
        () => dio.patch<void>(
          '/users/me/complete-profile',
          data: {'name': 'Jane', 'phone': '555-0100'},
        ),
      ).thenAnswer((_) async => _response<void>(null));

      await repository.completeProfile(name: 'Jane', phone: '555-0100');

      verify(
        () => dio.patch<void>(
          '/users/me/complete-profile',
          data: {'name': 'Jane', 'phone': '555-0100'},
        ),
      ).called(1);
    });
  });

  group('deleteProfileImage', () {
    test('deletes with the profileImageUrl in the request body', () async {
      when(
        () => dio.delete<void>(
          '/users/profile-image',
          data: {'profileImageUrl': 'https://cdn.example.com/old.png'},
        ),
      ).thenAnswer((_) async => _response<void>(null));

      await repository.deleteProfileImage('https://cdn.example.com/old.png');

      verify(
        () => dio.delete<void>(
          '/users/profile-image',
          data: {'profileImageUrl': 'https://cdn.example.com/old.png'},
        ),
      ).called(1);
    });
  });

  group('uploadProfileImage', () {
    late Directory tempDir;
    late HttpServer s3Server;

    setUp(() async {
      tempDir = await Directory.systemTemp.createTemp('account_repo_test');
      s3Server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    });

    tearDown(() async {
      await s3Server.close(force: true);
      await tempDir.delete(recursive: true);
    });

    test(
      'presigns, PUTs raw bytes straight to S3 with no auth header, then '
      'PATCHes the confirmed URL',
      () async {
        final file = File('${tempDir.path}/avatar.png');
        await file.writeAsBytes(List<int>.filled(16, 1));

        final presignedUrl = 'http://${s3Server.address.address}:${s3Server.port}/bucket/avatar.png';

        // Captures exactly what the bare (non-shared, non-interceptor) Dio
        // instance sends for the S3 PUT — headers in particular, since the
        // whole point of a presigned URL is that it must NOT carry this
        // app's own Bearer token.
        final capturedHeaders = <String, String>{};
        String? capturedMethod;
        final s3Requests = s3Server.listen((request) async {
          capturedMethod = request.method;
          request.headers.forEach((name, values) {
            capturedHeaders[name] = values.join(',');
          });
          await request.drain<void>();
          request.response.statusCode = 200;
          await request.response.close();
        });

        when(
          () => dio.post<Map<String, dynamic>>(
            '/users/profile-image-url',
            data: {
              'fileName': 'avatar.png',
              'fileSize': 16,
              'contentType': 'image/png',
            },
          ),
        ).thenAnswer(
          (_) async => _response({
            'presignedUrl': presignedUrl,
            'profileImageUrl': 'https://cdn.example.com/new-avatar.png',
          }),
        );
        when(
          () => dio.patch<void>(
            '/users/profile-image',
            data: {'profileImageUrl': 'https://cdn.example.com/new-avatar.png'},
          ),
        ).thenAnswer((_) async => _response<void>(null));

        await repository.uploadProfileImage(file);
        await s3Requests.cancel();

        // Step 1: presigned URL was requested with the right file metadata.
        verify(
          () => dio.post<Map<String, dynamic>>(
            '/users/profile-image-url',
            data: {
              'fileName': 'avatar.png',
              'fileSize': 16,
              'contentType': 'image/png',
            },
          ),
        ).called(1);

        // Step 2: the raw bytes went straight to S3 via PUT...
        expect(capturedMethod, 'PUT');
        // ...and deliberately without this app's own authorization header —
        // a presigned URL *is* its own auth, and the bare `Dio()` used here
        // must not pick up the shared client's auth-refresh interceptor.
        expect(capturedHeaders.containsKey('authorization'), isFalse);

        // Step 3: the user record was PATCHed with the now-public URL.
        verify(
          () => dio.patch<void>(
            '/users/profile-image',
            data: {'profileImageUrl': 'https://cdn.example.com/new-avatar.png'},
          ),
        ).called(1);
      },
    );

    test('picks contentType from the file extension (heic)', () async {
      final file = File('${tempDir.path}/avatar.heic');
      await file.writeAsBytes(List<int>.filled(4, 0));
      final presignedUrl = 'http://${s3Server.address.address}:${s3Server.port}/bucket/avatar.heic';

      s3Server.listen((request) async {
        await request.drain<void>();
        request.response.statusCode = 200;
        await request.response.close();
      });

      when(
        () => dio.post<Map<String, dynamic>>(
          '/users/profile-image-url',
          data: {
            'fileName': 'avatar.heic',
            'fileSize': 4,
            'contentType': 'image/heic',
          },
        ),
      ).thenAnswer(
        (_) async => _response({
          'presignedUrl': presignedUrl,
          'profileImageUrl': 'https://cdn.example.com/avatar.heic',
        }),
      );
      when(
        () => dio.patch<void>('/users/profile-image', data: any(named: 'data')),
      ).thenAnswer((_) async => _response<void>(null));

      await repository.uploadProfileImage(file);

      verify(
        () => dio.post<Map<String, dynamic>>(
          '/users/profile-image-url',
          data: {
            'fileName': 'avatar.heic',
            'fileSize': 4,
            'contentType': 'image/heic',
          },
        ),
      ).called(1);
    });
  });

  group('currentUserProvider', () {
    Map<String, dynamic> userJson() => {
          'id': 7,
          'email': 'jane@example.com',
          'name': 'Jane',
          'phone': '',
          'profileImageUrl': null,
          'profileCompleted': true,
        };

    ProviderContainer containerWith(_FakeAuthController auth) {
      final container = ProviderContainer(
        overrides: [
          accountRepositoryProvider.overrideWithValue(repository),
          authControllerProvider.overrideWith(() => auth),
        ],
      );
      addTearDown(container.dispose);
      return container;
    }

    test('never calls /users/me while signed out', () async {
      // The router listens to this provider from the very first frame, so a
      // signed-out fetch here was a 401 on every cold start — which the auth
      // interceptor then surfaced as "Your session has expired".
      final container = containerWith(_FakeAuthController(isAuthenticated: false));
      container.listen(currentUserProvider, (_, _) {});
      await Future<void>.delayed(Duration.zero);

      expect(container.read(currentUserProvider).isLoading, isTrue);
      verifyNever(() => dio.get<Map<String, dynamic>>('/users/me'));
    });

    test('fetches the user once signed in', () async {
      when(() => dio.get<Map<String, dynamic>>('/users/me'))
          .thenAnswer((_) async => _response(userJson()));
      final auth = _FakeAuthController(isAuthenticated: false);
      final container = containerWith(auth);
      container.listen(currentUserProvider, (_, _) {});
      await Future<void>.delayed(Duration.zero);

      auth.setAuthenticated(true);
      final user = await container.read(currentUserProvider.future);

      expect(user.email, 'jane@example.com');
      verify(() => dio.get<Map<String, dynamic>>('/users/me')).called(1);
    });
  });
}
