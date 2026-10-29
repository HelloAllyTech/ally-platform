import 'package:dio/dio.dart';

/// Port of RN `src/utils/error.ts`.
///
/// RN reads the RTK Query error shape `{status, data: {message, error}}`;
/// here the same fields come off a [DioException]'s response (or a plain
/// map of that shape, or a string).
class ErrorDetails {
  const ErrorDetails({required this.message, this.status, this.error});

  /// `data.message || data.error || t('common.somethingWentWrong')`.
  final String message;

  /// HTTP status, when the server answered.
  final int? status;

  /// The body's `error` code (e.g. `USER_SUSPENDED`).
  final String? error;
}

/// RN calls i18next's global `t` inside `getErrorDetails`. The app's
/// translations live in a Riverpod provider, so the app root (`main.dart`)
/// registers a lookup here; until then a key resolves to itself, i18next's
/// own missing-key behaviour. Widgets can pass `t: ref.tr` instead.
String Function(String key) errorTranslator = (key) => key;

const somethingWentWrongKey = 'common.somethingWentWrong';

/// RN `getErrorDetails`. Never returns the raw exception text: a network
/// failure with no body, or any non-API error, gives the translated
/// `common.somethingWentWrong` (pass [t] to translate with a specific
/// lookup instead of [errorTranslator]).
ErrorDetails getErrorDetails(Object? error, {String Function(String key)? t}) {
  if (error is String) return ErrorDetails(message: error);

  int? status;
  Object? data;
  if (error is DioException) {
    status = error.response?.statusCode;
    data = error.response?.data;
  } else if (error is Map) {
    final s = error['status'];
    status = s is int ? s : null;
    data = error['data'];
  }

  String? message;
  String? code;
  if (data is Map) {
    message = _nonEmpty(data['message']);
    code = _nonEmpty(data['error']);
  }
  return ErrorDetails(
    message: message ?? code ?? (t ?? errorTranslator)(somethingWentWrongKey),
    status: status,
    error: code,
  );
}

/// RN `isBackendApiError`: the error carries an HTTP status, i.e. the
/// server answered (as opposed to a timeout or no connection).
bool isBackendApiError(Object? error) {
  if (error is DioException) return error.response?.statusCode != null;
  if (error is Map) return error['status'] != null;
  return false;
}

/// RN `isSuspendedUserError`: 403 with `error: USER_SUSPENDED` or the
/// literal message `User suspended`.
bool isSuspendedUserError(Object? error) {
  final details = getErrorDetails(error);
  return details.status == 403 &&
      (details.error == 'USER_SUSPENDED' || details.message == 'User suspended');
}

String? _nonEmpty(Object? value) {
  if (value is String && value.isNotEmpty) return value;
  // NestJS validation errors send `message: string[]`.
  if (value is List && value.isNotEmpty) return value.join(', ');
  return null;
}
