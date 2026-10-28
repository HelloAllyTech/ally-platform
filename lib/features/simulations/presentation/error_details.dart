import 'package:dio/dio.dart';

/// RN `utils/error.ts` `getErrorDetails(err).message`: the API's `message`
/// (or `error`) field, else [fallback] (RN `common.somethingWentWrong`).
/// Never the raw exception text.
String errorDetailsMessage(Object error, String fallback) {
  if (error is DioException) {
    final data = error.response?.data;
    if (data is Map) {
      final message = data['message'];
      if (message is String && message.isNotEmpty) return message;
      if (message is List && message.isNotEmpty) return message.join(', ');
      final err = data['error'];
      if (err is String && err.isNotEmpty) return err;
    }
  }
  return fallback;
}
