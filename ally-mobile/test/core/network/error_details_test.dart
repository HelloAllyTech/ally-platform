import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/network/error_details.dart';

DioException _dio({int? status, Object? data}) {
  final options = RequestOptions(path: '/x');
  return DioException(
    requestOptions: options,
    response: status == null ? null : Response(requestOptions: options, statusCode: status, data: data),
    type: status == null ? DioExceptionType.connectionError : DioExceptionType.badResponse,
    message: 'RequestOptions.validateStatus was configured to throw…',
  );
}

String _t(String key) => key == somethingWentWrongKey ? 'Something went wrong!' : key;

void main() {
  group('getErrorDetails (RN utils/error.ts)', () {
    test('uses the body message first, with the status', () {
      final details = getErrorDetails(_dio(status: 400, data: {'message': 'Bad name', 'error': 'Bad Request'}), t: _t);
      expect(details.message, 'Bad name');
      expect(details.status, 400);
      expect(details.error, 'Bad Request');
    });

    test('falls back to the body error, then the translated fallback', () {
      expect(getErrorDetails(_dio(status: 500, data: {'error': 'Oops'}), t: _t).message, 'Oops');
      expect(getErrorDetails(_dio(status: 500, data: '<html>'), t: _t).message, 'Something went wrong!');
      expect(getErrorDetails(_dio(status: 500, data: {'message': ''}), t: _t).message, 'Something went wrong!');
    });

    test('joins NestJS validation message lists', () {
      expect(getErrorDetails(_dio(status: 400, data: {'message': ['a', 'b']}), t: _t).message, 'a, b');
    });

    test('never shows the raw exception text', () {
      final details = getErrorDetails(_dio(), t: _t);
      expect(details.message, 'Something went wrong!');
      expect(details.status, isNull);
      expect(getErrorDetails(StateError('boom'), t: _t).message, 'Something went wrong!');
    });

    test('a string is its own message', () {
      expect(getErrorDetails('Plain', t: _t).message, 'Plain');
    });

    test('uses the registered translator by default', () {
      final previous = errorTranslator;
      addTearDown(() => errorTranslator = previous);
      errorTranslator = _t;
      expect(getErrorDetails(null).message, 'Something went wrong!');
    });
  });

  test('isBackendApiError: only when the server answered', () {
    expect(isBackendApiError(_dio(status: 404)), isTrue);
    expect(isBackendApiError(_dio()), isFalse);
    expect(isBackendApiError(StateError('x')), isFalse);
  });

  test('isSuspendedUserError: 403 with USER_SUSPENDED or "User suspended"', () {
    expect(isSuspendedUserError(_dio(status: 403, data: {'error': 'USER_SUSPENDED'})), isTrue);
    expect(isSuspendedUserError(_dio(status: 403, data: {'message': 'User suspended'})), isTrue);
    expect(isSuspendedUserError(_dio(status: 403, data: {'message': 'Forbidden'})), isFalse);
    expect(isSuspendedUserError(_dio(status: 401, data: {'error': 'USER_SUSPENDED'})), isFalse);
  });
}
