import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/network/api_routes.dart';
import 'package:ally_mobile_flutter/core/network/auth_interceptor.dart';
import 'package:ally_mobile_flutter/core/network/token_storage.dart';

class MockDio extends Mock implements Dio {}

class MockTokenStorage extends Mock implements TokenStorage {}

Response<T> _response<T>(T? data, {int statusCode = 200, RequestOptions? requestOptions}) =>
    Response<T>(
      data: data,
      statusCode: statusCode,
      requestOptions: requestOptions ?? RequestOptions(path: ''),
    );

/// Captures what the interceptor did with the request, instead of relying
/// on dio's internal `_BaseHandler.future` (marked `@protected`, and whose
/// `InterceptorState`/`InterceptorResultType` types aren't exported from
/// package:dio's public barrel anyway). `AuthInterceptor.onRequest` is
/// itself `async` and calls `handler.next(...)` as its very last statement,
/// so simply awaiting the interceptor call directly gives us the result.
class _RecordingRequestHandler extends RequestInterceptorHandler {
  RequestOptions? nextOptions;

  @override
  void next(RequestOptions requestOptions) {
    nextOptions = requestOptions;
  }
}

/// Same idea as [_RecordingRequestHandler], for the `onError` side.
/// `AuthInterceptor.onError` only ever calls `handler.next` (pass the
/// original error through) or `handler.resolve` (the retried response) —
/// never `handler.reject` — so only those two are overridden.
class _RecordingErrorHandler extends ErrorInterceptorHandler {
  DioException? passedThroughError;
  Response<dynamic>? resolvedWith;

  @override
  void next(DioException error) {
    passedThroughError = error;
  }

  @override
  void resolve(Response<dynamic> response) {
    resolvedWith = response;
  }
}

void main() {
  late MockDio refreshDio;
  late MockTokenStorage tokenStorage;
  late int unrecoverableCalls;
  late AuthInterceptor interceptor;

  setUpAll(() {
    registerFallbackValue(RequestOptions(path: ''));
  });

  setUp(() {
    refreshDio = MockDio();
    tokenStorage = MockTokenStorage();
    unrecoverableCalls = 0;
    interceptor = AuthInterceptor(
      refreshDio: refreshDio,
      tokenStorage: tokenStorage,
      onUnrecoverable: () async {
        unrecoverableCalls++;
        return 'Your session has expired. Please sign in again.';
      },
    );
  });

  group('onRequest', () {
    test('prefixes a default path with /v1', () async {
      when(() => tokenStorage.accessToken).thenAnswer((_) async => null);

      final handler = _RecordingRequestHandler();
      await interceptor.onRequest(RequestOptions(path: '/users/me'), handler);

      expect(handler.nextOptions!.path, '/v1/users/me');
    });

    test('prefixes a v2Endpoints route with /v2', () async {
      when(() => tokenStorage.accessToken).thenAnswer((_) async => null);

      final handler = _RecordingRequestHandler();
      await interceptor.onRequest(RequestOptions(path: ApiRoutes.learnScenarios), handler);

      expect(handler.nextOptions!.path, '/v2${ApiRoutes.learnScenarios}');
    });

    test(
      'does not v2-match a path that merely starts with a v2Endpoints route '
      '(RN matches with exact equality, not a prefix check)',
      () async {
        when(() => tokenStorage.accessToken).thenAnswer((_) async => null);

        final handler = _RecordingRequestHandler();
        await interceptor.onRequest(
          RequestOptions(path: '${ApiRoutes.learnScenarios}/7'),
          handler,
        );

        expect(handler.nextOptions!.path, '/v1${ApiRoutes.learnScenarios}/7');
      },
    );

    test('adds the bearer header when an access token exists', () async {
      when(() => tokenStorage.accessToken).thenAnswer((_) async => 'the-access-token');

      final handler = _RecordingRequestHandler();
      await interceptor.onRequest(RequestOptions(path: '/users/me'), handler);

      expect(handler.nextOptions!.headers['authorization'], 'Bearer the-access-token');
    });

    test('omits the auth header when there is no access token', () async {
      when(() => tokenStorage.accessToken).thenAnswer((_) async => null);

      final handler = _RecordingRequestHandler();
      await interceptor.onRequest(RequestOptions(path: '/users/me'), handler);

      expect(handler.nextOptions!.headers.containsKey('authorization'), isFalse);
    });
  });

  group('onError', () {
    test('passes through non-401 errors untouched', () async {
      final requestOptions = RequestOptions(path: '/v1/users/me');
      final err = DioException(
        requestOptions: requestOptions,
        response: _response<void>(null, statusCode: 500, requestOptions: requestOptions),
      );

      final handler = _RecordingErrorHandler();
      await interceptor.onError(err, handler);

      expect(handler.passedThroughError, same(err));
      expect(handler.resolvedWith, isNull);
      expect(unrecoverableCalls, 0);
      verifyNever(() => tokenStorage.refreshToken);
    });

    test(
      '401 with no stored refresh/access token calls onUnrecoverable and replaces '
      'the propagated error with its message',
      () async {
        final requestOptions = RequestOptions(path: '/v1/users/me');
        final err = DioException(
          requestOptions: requestOptions,
          response: _response<void>(null, statusCode: 401, requestOptions: requestOptions),
        );
        when(() => tokenStorage.refreshToken).thenAnswer((_) async => null);
        when(() => tokenStorage.accessToken).thenAnswer((_) async => null);

        final handler = _RecordingErrorHandler();
        await interceptor.onError(err, handler);

        // Not `same(err)` — a screen whose request lost this race must not
        // render the original technical failure (confirmed live: it did,
        // even once onUnrecoverable also started showing a snackbar).
        expect(handler.passedThroughError, isNot(same(err)));
        expect(
          handler.passedThroughError?.message,
          'Your session has expired. Please sign in again.',
        );
        // What a generic `'${t('common.somethingWentWrong')} $error'` error
        // branch actually interpolates — must read as the clean message,
        // not the multi-paragraph "RequestOptions.validateStatus..." dump
        // `err.toString()` itself would have produced.
        expect(
          handler.passedThroughError.toString(),
          'DioException [unknown]: Your session has expired. Please sign in again.',
        );
        expect(unrecoverableCalls, 1);
        verifyNever(() => refreshDio.post<Map<String, dynamic>>(any(), data: any(named: 'data')));
      },
    );

    test('401 -> refresh succeeds -> retries the original request', () async {
      final requestOptions = RequestOptions(path: '/v1/users/me');
      final err = DioException(
        requestOptions: requestOptions,
        response: _response<void>(null, statusCode: 401, requestOptions: requestOptions),
      );
      when(() => tokenStorage.refreshToken).thenAnswer((_) async => 'old-refresh-token');
      when(() => tokenStorage.accessToken).thenAnswer((_) async => 'old-access-token');
      when(
        () => refreshDio.post<Map<String, dynamic>>(
          '/v1${ApiRoutes.authRefresh}',
          data: {'refreshToken': 'old-refresh-token'},
        ),
      ).thenAnswer(
        (_) async => _response({
          'accessToken': 'new-access-token',
          'refreshToken': 'new-refresh-token',
        }),
      );
      when(
        () => tokenStorage.storeTokens(
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
        ),
      ).thenAnswer((_) async {});
      final retryResponse = _response<void>(null, requestOptions: requestOptions);
      when(() => refreshDio.fetch<dynamic>(any())).thenAnswer((_) async => retryResponse);

      final handler = _RecordingErrorHandler();
      await interceptor.onError(err, handler);

      expect(handler.resolvedWith, same(retryResponse));
      expect(handler.passedThroughError, isNull);
      expect(requestOptions.headers['authorization'], 'Bearer new-access-token');
      verify(
        () => tokenStorage.storeTokens(
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
        ),
      ).called(1);
      expect(unrecoverableCalls, 0);
    });

    test(
      '401 -> refresh returns incomplete data -> onUnrecoverable is called and its '
      'message replaces the propagated error',
      () async {
        final requestOptions = RequestOptions(path: '/v1/users/me');
        final err = DioException(
          requestOptions: requestOptions,
          response: _response<void>(null, statusCode: 401, requestOptions: requestOptions),
        );
        when(() => tokenStorage.refreshToken).thenAnswer((_) async => 'old-refresh-token');
        when(() => tokenStorage.accessToken).thenAnswer((_) async => 'old-access-token');
        // Refresh "succeeds" (200) but is missing the new tokens.
        when(
          () => refreshDio.post<Map<String, dynamic>>(
            '/v1${ApiRoutes.authRefresh}',
            data: {'refreshToken': 'old-refresh-token'},
          ),
        ).thenAnswer((_) async => _response({'accessToken': 'new-access-token'}));

        final handler = _RecordingErrorHandler();
        await interceptor.onError(err, handler);

        expect(handler.passedThroughError, isNot(same(err)));
        expect(
          handler.passedThroughError?.message,
          'Your session has expired. Please sign in again.',
        );
        expect(handler.resolvedWith, isNull);
        expect(unrecoverableCalls, 1);
        verifyNever(
          () => tokenStorage.storeTokens(
            accessToken: any(named: 'accessToken'),
            refreshToken: any(named: 'refreshToken'),
          ),
        );
      },
    );

    test(
      'two concurrent 401s share one refresh call and both retry with the '
      'same new access token (previously each raced its own refresh call '
      'against a single-use refresh token, and the loser fell through to '
      'onUnrecoverable even though the session itself was fine)',
      () async {
        final requestOptionsA = RequestOptions(path: '/v1/users/me');
        final requestOptionsB = RequestOptions(path: '/v1/users/tenant');
        final errA = DioException(
          requestOptions: requestOptionsA,
          response: _response<void>(null, statusCode: 401, requestOptions: requestOptionsA),
        );
        final errB = DioException(
          requestOptions: requestOptionsB,
          response: _response<void>(null, statusCode: 401, requestOptions: requestOptionsB),
        );
        when(() => tokenStorage.refreshToken).thenAnswer((_) async => 'old-refresh-token');
        when(() => tokenStorage.accessToken).thenAnswer((_) async => 'old-access-token');

        // A `Completer` stands in for the refresh call actually being
        // in-flight when the second 401 arrives, rather than resolved
        // instantly — the exact window the race happens in.
        final refreshCompleter = Completer<Response<Map<String, dynamic>>>();
        when(
          () => refreshDio.post<Map<String, dynamic>>(
            '/v1${ApiRoutes.authRefresh}',
            data: {'refreshToken': 'old-refresh-token'},
          ),
        ).thenAnswer((_) => refreshCompleter.future);
        when(
          () => tokenStorage.storeTokens(
            accessToken: 'new-access-token',
            refreshToken: 'new-refresh-token',
          ),
        ).thenAnswer((_) async {});
        final retryResponseA = _response<void>(null, requestOptions: requestOptionsA);
        final retryResponseB = _response<void>(null, requestOptions: requestOptionsB);
        when(() => refreshDio.fetch<dynamic>(requestOptionsA)).thenAnswer((_) async => retryResponseA);
        when(() => refreshDio.fetch<dynamic>(requestOptionsB)).thenAnswer((_) async => retryResponseB);

        final handlerA = _RecordingErrorHandler();
        final handlerB = _RecordingErrorHandler();
        final futureA = interceptor.onError(errA, handlerA);
        final futureB = interceptor.onError(errB, handlerB);

        // Let both onError calls run up to (and block on) the refresh call.
        await Future<void>.delayed(Duration.zero);
        refreshCompleter.complete(
          _response({'accessToken': 'new-access-token', 'refreshToken': 'new-refresh-token'}),
        );
        await Future.wait([futureA, futureB]);

        expect(handlerA.resolvedWith, same(retryResponseA));
        expect(handlerB.resolvedWith, same(retryResponseB));
        expect(requestOptionsA.headers['authorization'], 'Bearer new-access-token');
        expect(requestOptionsB.headers['authorization'], 'Bearer new-access-token');
        expect(unrecoverableCalls, 0);
        // The one and only refresh call — not one per 401.
        verify(
          () => refreshDio.post<Map<String, dynamic>>(
            '/v1${ApiRoutes.authRefresh}',
            data: {'refreshToken': 'old-refresh-token'},
          ),
        ).called(1);
      },
    );

    test(
      '401 -> refresh call itself throws -> onUnrecoverable is called and its '
      'message replaces the propagated error',
      () async {
        final requestOptions = RequestOptions(path: '/v1/users/me');
        final err = DioException(
          requestOptions: requestOptions,
          response: _response<void>(null, statusCode: 401, requestOptions: requestOptions),
        );
        when(() => tokenStorage.refreshToken).thenAnswer((_) async => 'old-refresh-token');
        when(() => tokenStorage.accessToken).thenAnswer((_) async => 'old-access-token');
        when(
          () => refreshDio.post<Map<String, dynamic>>(
            '/v1${ApiRoutes.authRefresh}',
            data: {'refreshToken': 'old-refresh-token'},
          ),
        ).thenThrow(DioException(requestOptions: requestOptions));

        final handler = _RecordingErrorHandler();
        await interceptor.onError(err, handler);

        expect(handler.passedThroughError, isNot(same(err)));
        expect(
          handler.passedThroughError?.message,
          'Your session has expired. Please sign in again.',
        );
        expect(handler.resolvedWith, isNull);
        expect(unrecoverableCalls, 1);
      },
    );
  });
}
