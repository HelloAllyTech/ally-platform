import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../network/api_client.dart';
import 'ask_ai_chat_models.dart';
import 'sse_event_parser.dart';

/// A chat failure carrying the message RN's `chatSessionManager.ts` shows
/// for the same case (its strings are hard-coded English, not translated).
class AskAiChatException implements Exception {
  const AskAiChatException(this.message);
  final String message;

  @override
  String toString() => message;
}

/// The two scenario-session chat endpoints (ally-be
/// `learn/controller/scenario-session-chat.controller.ts`).
///
/// RN talks to these with raw `fetch`/`XMLHttpRequest` and its own copy of
/// the token refresh. Here both go through the app's shared [Dio], so the
/// `AuthInterceptor` adds the `/v1` prefix and bearer token, and a 401
/// before the stream starts is refreshed and retried by it (the retried
/// request keeps `ResponseType.stream`, so the retry streams too).
class AskAiChatApi {
  AskAiChatApi(this._dio);

  final Dio _dio;

  static String historyPath(String sessionId) =>
      '/learn/scenario-sessions/$sessionId/chat/history';
  static String streamPath(String sessionId) =>
      '/learn/scenario-sessions/$sessionId/chat/stream';

  Future<List<AskAiChatMessage>> getHistory(String sessionId) async {
    final response = await _dio.get<List<dynamic>>(historyPath(sessionId));
    return (response.data ?? const [])
        .map((e) => AskAiChatMessage.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// `POST .../chat/stream {message}` as server-sent events, parsed with
  /// [SseEventParser]. Ends (after flushing any unterminated last event)
  /// when the server closes the response. Errors surface as
  /// [AskAiChatException]; a [cancelToken] cancel surfaces as the
  /// `DioException` of type `cancel`, which callers treat as silence.
  Stream<AskAiSseEvent> streamChat(
    String sessionId,
    String message, {
    CancelToken? cancelToken,
  }) async* {
    final Response<ResponseBody> response;
    try {
      response = await _dio.post<ResponseBody>(
        streamPath(sessionId),
        data: {'message': message},
        cancelToken: cancelToken,
        options: Options(
          responseType: ResponseType.stream,
          headers: {'Accept': 'text/event-stream'},
        ),
      );
    } on DioException catch (e) {
      if (e.type == DioExceptionType.cancel) rethrow;
      throw await _toChatException(e);
    }

    final body = response.data;
    if (body == null) return;
    final parser = SseEventParser();
    try {
      await for (final chunk in body.stream.cast<List<int>>().transform(utf8.decoder)) {
        for (final event in parser.add(chunk)) {
          yield event;
        }
      }
    } on DioException catch (e) {
      if (e.type == DioExceptionType.cancel) rethrow;
      throw await _toChatException(e);
    } on AskAiChatException {
      rethrow;
    } catch (_) {
      throw const AskAiChatException(networkErrorMessage);
    }
    for (final event in parser.flush()) {
      yield event;
    }
  }

  static const networkErrorMessage =
      'Network error. Please check your connection and try again.';
  static const timeoutMessage = 'Request timed out. Please try again.';

  /// RN `onload`'s `status >= 400` branch (`errorBody.message`, joined when
  /// it's an array, else `Request failed with status N`), plus its
  /// `onerror` / `ontimeout` messages for transport failures.
  static Future<AskAiChatException> _toChatException(DioException e) async {
    final response = e.response;
    if (response != null) {
      final status = response.statusCode ?? 0;
      try {
        final raw = await _readBody(response.data);
        final decoded = jsonDecode(raw);
        final message = decoded is Map ? decoded['message'] : null;
        if (message is List) return AskAiChatException(message.join(', '));
        if (message is String && message.isNotEmpty) return AskAiChatException(message);
        return AskAiChatException(response.statusMessage ?? 'Request failed with status $status');
      } catch (_) {
        return AskAiChatException('Request failed with status $status');
      }
    }
    switch (e.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return const AskAiChatException(timeoutMessage);
      case DioExceptionType.unknown:
        // The AuthInterceptor's unrecoverable-401 replacement carries the
        // already-translated session-expired copy as its message.
        final message = e.message;
        if (message != null && message.isNotEmpty && e.error == null) {
          return AskAiChatException(message);
        }
        return const AskAiChatException(networkErrorMessage);
      default:
        return const AskAiChatException(networkErrorMessage);
    }
  }

  static Future<String> _readBody(Object? data) async {
    if (data is ResponseBody) {
      return utf8.decodeStream(data.stream.cast<List<int>>());
    }
    if (data is String) return data;
    return jsonEncode(data);
  }
}

final askAiChatApiProvider = Provider<AskAiChatApi>((ref) {
  return AskAiChatApi(ref.watch(apiClientProvider));
});
