import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/network/auth_interceptor.dart';
import 'package:ally_mobile_flutter/core/network/token_storage.dart';
import 'package:ally_mobile_flutter/core/widgets/ask_ai_chat/ask_ai_chat.dart';

class MockTokenStorage extends Mock implements TokenStorage {}

/// Answers each request with [handler]; records what was asked.
class FakeAdapter implements HttpClientAdapter {
  FakeAdapter(this.handler);

  final ResponseBody Function(RequestOptions options) handler;
  final requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    requests.add(options);
    return handler(options);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody _sse(List<String> chunks, {int status = 200}) => ResponseBody(
  Stream.fromIterable(chunks.map((c) => Uint8List.fromList(utf8.encode(c)))),
  status,
  headers: {
    Headers.contentTypeHeader: ['text/event-stream'],
  },
);

ResponseBody _json(Object body, int status) => ResponseBody.fromString(
  jsonEncode(body),
  status,
  headers: {
    Headers.contentTypeHeader: [Headers.jsonContentType],
  },
);

void main() {
  late MockTokenStorage tokens;

  setUp(() {
    tokens = MockTokenStorage();
    when(() => tokens.accessToken).thenAnswer((_) async => 'old-access');
    when(() => tokens.refreshToken).thenAnswer((_) async => 'refresh');
    when(
      () => tokens.storeTokens(accessToken: any(named: 'accessToken'), refreshToken: any(named: 'refreshToken')),
    ).thenAnswer((_) async {});
  });

  /// The app's real wiring: a main Dio with the AuthInterceptor, and a bare
  /// refresh Dio it retries through.
  ({AskAiChatApi api, FakeAdapter main, FakeAdapter refresh}) build({
    required ResponseBody Function(RequestOptions) mainHandler,
    ResponseBody Function(RequestOptions)? refreshHandler,
  }) {
    final mainAdapter = FakeAdapter(mainHandler);
    final refreshAdapter = FakeAdapter(refreshHandler ?? mainHandler);
    final refreshDio = Dio(BaseOptions(baseUrl: 'https://api.test/api'))..httpClientAdapter = refreshAdapter;
    final dio = Dio(BaseOptions(baseUrl: 'https://api.test/api'))..httpClientAdapter = mainAdapter;
    dio.interceptors.add(
      AuthInterceptor(refreshDio: refreshDio, tokenStorage: tokens, onUnrecoverable: () async => 'Session expired'),
    );
    return (api: AskAiChatApi(dio), main: mainAdapter, refresh: refreshAdapter);
  }

  test('streams events from a chunked SSE body, posting {message} with bearer + /v1', () async {
    final t = build(
      mainHandler: (_) => _sse([
        'data: {"type":"start"}\n\ndata: {"type":"tok',
        'en","content":"Hi"}\n\n',
        'data: {"type":"done"}', // unterminated: flushed at end
      ]),
    );

    final events = await t.api.streamChat('s-1', 'Hello?').toList();

    expect(events.map((e) => e.runtimeType), [AskAiSseStart, AskAiSseToken, AskAiSseDone]);
    final request = t.main.requests.single;
    expect(request.path, '/v1/learn/scenario-sessions/s-1/chat/stream');
    expect(request.method, 'POST');
    expect(request.data, {'message': 'Hello?'});
    expect(request.headers['authorization'], 'Bearer old-access');
    expect(request.responseType, ResponseType.stream);
  });

  test('a 401 before the stream starts is refreshed by the AuthInterceptor and retried as a stream', () async {
    final t = build(
      mainHandler: (_) => _json({'message': 'Unauthorized'}, 401),
      refreshHandler: (options) {
        if (options.path.endsWith('/auth/refresh')) {
          return _json({'accessToken': 'new-access', 'refreshToken': 'new-refresh'}, 201);
        }
        return _sse(['data: {"type":"token","content":"after refresh"}\n\n']);
      },
    );

    final events = await t.api.streamChat('s-1', 'Hello?').toList();

    expect((events.single as AskAiSseToken).content, 'after refresh');
    verify(() => tokens.storeTokens(accessToken: 'new-access', refreshToken: 'new-refresh')).called(1);
    final retried = t.refresh.requests.last;
    expect(retried.path, '/v1/learn/scenario-sessions/s-1/chat/stream');
    expect(retried.headers['authorization'], 'Bearer new-access');
    expect(retried.data, {'message': 'Hello?'});
  });

  test('a 4xx body message becomes the chat error (arrays joined, as RN does)', () async {
    final t = build(mainHandler: (_) => _json({'message': ['too long', 'bad']}, 400));

    await expectLater(
      t.api.streamChat('s-1', 'x').toList(),
      throwsA(isA<AskAiChatException>().having((e) => e.message, 'message', 'too long, bad')),
    );
  });

  test('a body with no message falls back to "Request failed with status N"', () async {
    final t = build(mainHandler: (_) => ResponseBody.fromString('oops', 500));

    await expectLater(
      t.api.streamChat('s-1', 'x').toList(),
      throwsA(isA<AskAiChatException>().having((e) => e.message, 'message', 'Request failed with status 500')),
    );
  });

  test('history is read from GET .../chat/history', () async {
    final t = build(
      mainHandler: (_) => _json([
        {'id': 1, 'role': 'user', 'content': 'Q', 'createdAt': ''},
        {
          'id': 2,
          'role': 'assistant',
          'content': 'A [0:05]',
          'createdAt': '',
          'citations': [
            {'timestamp': '0:05', 'content': 'hi', 'senderId': -1, 'transcriptId': 3},
          ],
        },
      ], 200),
    );

    final history = await t.api.getHistory('s-1');

    expect(t.main.requests.single.path, '/v1/learn/scenario-sessions/s-1/chat/history');
    expect(history.map((m) => m.role), [AskAiChatRole.user, AskAiChatRole.assistant]);
    expect(history.last.citations!.single.transcriptId, 3);
  });
}
