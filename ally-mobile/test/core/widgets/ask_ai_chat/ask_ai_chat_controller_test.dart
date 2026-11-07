import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/widgets/ask_ai_chat/ask_ai_chat.dart';

class MockAskAiChatApi extends Mock implements AskAiChatApi {}

void main() {
  late MockAskAiChatApi api;
  late StreamController<AskAiSseEvent> stream;
  late AskAiChatController chat;
  CancelToken? lastToken;

  setUp(() {
    api = MockAskAiChatApi();
    stream = StreamController<AskAiSseEvent>();
    when(() => api.streamChat(any(), any(), cancelToken: any(named: 'cancelToken'))).thenAnswer((invocation) {
      lastToken = invocation.namedArguments[#cancelToken] as CancelToken?;
      return stream.stream;
    });
    chat = AskAiChatController(api: api, sessionId: 's-1');
  });

  tearDown(() => chat.dispose());

  Future<void> settle() => Future<void>.delayed(Duration.zero);

  test('tokens accumulate in the streaming message; done commits it', () async {
    chat.sendMessage('  Why?  ');
    expect(chat.messages.single.content, 'Why?');
    expect(chat.isStreaming, isTrue);

    stream.add(const AskAiSseToken('Be'));
    stream.add(const AskAiSseToken('cause'));
    await settle();
    expect(chat.streamingMessage!.content, 'Because');
    expect(chat.allMessages, hasLength(2));

    stream.add(const AskAiSseDone());
    await settle();
    expect(chat.isStreaming, isFalse);
    expect(chat.streamingMessage, isNull);
    expect(chat.messages.last.content, 'Because');
    expect(chat.messages.last.isStreaming, isFalse);
  });

  test("done's own content and citations win when present", () async {
    chat.sendMessage('Q');
    stream.add(const AskAiSseToken('partial'));
    stream.add(
      const AskAiSseDone(
        content: 'final',
        citations: [AskAiCitation(timestamp: '0:01', content: 'c', senderId: 1, transcriptId: 2)],
      ),
    );
    await settle();
    expect(chat.messages.last.content, 'final');
    expect(chat.messages.last.citations!.single.transcriptId, 2);
  });

  test('an error event drops the reply and sets the error; retry re-sends the last question', () async {
    chat.sendMessage('Q');
    stream.add(const AskAiSseError('nope'));
    await settle();
    expect(chat.error, 'nope');
    expect(chat.isInterrupted, isTrue);

    stream = StreamController<AskAiSseEvent>();
    chat.retry();
    expect(chat.error, isNull);
    verify(() => api.streamChat('s-1', 'Q', cancelToken: any(named: 'cancelToken'))).called(2);
  });

  test('a mid-stream network failure keeps what already streamed and shows the error', () async {
    chat.sendMessage('Q');
    stream.add(const AskAiSseToken('half an ans'));
    await settle();
    stream.addError(const AskAiChatException(AskAiChatApi.networkErrorMessage));
    await settle();
    expect(chat.messages.last.content, 'half an ans');
    expect(chat.error, AskAiChatApi.networkErrorMessage);
    expect(chat.isStreaming, isFalse);
  });

  test('a stream that just ends without "done" still commits the reply (RN onload)', () async {
    chat.sendMessage('Q');
    stream.add(const AskAiSseToken('ok'));
    await stream.close();
    await settle();
    expect(chat.messages.last.content, 'ok');
    expect(chat.isStreaming, isFalse);
  });

  test('sending is ignored while a reply is streaming', () async {
    chat.sendMessage('Q1');
    chat.sendMessage('Q2');
    expect(chat.messages.where((m) => m.role == AskAiChatRole.user), hasLength(1));
  });

  test('dispose cancels the in-flight request', () async {
    chat.sendMessage('Q');
    await settle();
    expect(lastToken!.isCancelled, isFalse);
    chat.dispose();
    expect(lastToken!.isCancelled, isTrue);
    chat = AskAiChatController(api: api, sessionId: 's-1'); // for tearDown
  });

  test('an empty session id (read-only debrief) never loads or sends', () async {
    final readOnly = AskAiChatController(api: api, sessionId: '');
    await readOnly.loadHistory();
    readOnly.sendMessage('Q');
    verifyNever(() => api.getHistory(any()));
    verifyNever(() => api.streamChat(any(), any(), cancelToken: any(named: 'cancelToken')));
    readOnly.dispose();
  });

  test('history loads once; a failure still marks it loaded', () async {
    when(() => api.getHistory('s-1')).thenThrow(Exception('boom'));
    await chat.loadHistory();
    await chat.loadHistory();
    expect(chat.isHistoryLoaded, isTrue);
    expect(chat.messages, isEmpty);
    verify(() => api.getHistory('s-1')).called(1);
  });
}
