import 'package:dio/dio.dart';

/// App-wide Riverpod retry policy, passed to the root `ProviderScope`.
///
/// Riverpod 3 retries every failing provider by default (up to 10 times,
/// 200ms doubling to 6.4s). A 4xx never heals on retry, so that turned one
/// rejected request into 5-6 identical ones per screen (seen live with
/// /users/me while signed out and a learner's reviewer-only unread count).
/// RTK Query, which the RN app uses, doesn't retry at all.
///
/// Retries only what can heal: network failures, timeouts and 5xx, at most
/// [maxRetries] times. Errors that aren't Exceptions (a StateError, a bad
/// cast while parsing) are bugs, not transient, so they aren't retried.
Duration? appRetryPolicy(int retryCount, Object error) {
  if (retryCount >= maxRetries) return null;
  if (error is DioException) {
    if (error.type == DioExceptionType.cancel) return null;
    final status = error.response?.statusCode;
    if (status != null && status >= 400 && status < 500) return null;
  } else if (error is! Exception) {
    return null;
  }
  return Duration(milliseconds: 400 * (1 << retryCount));
}

const maxRetries = 3;
