import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/widgets/ask_ai_chat/ask_ai_chat.dart';

void main() {
  group('SseEventParser (RN parseSSEBuffer)', () {
    test('an event split across chunk boundaries is emitted once it completes', () {
      final parser = SseEventParser();
      expect(parser.add('data: {"type":"tok'), isEmpty);
      expect(parser.add('en","content":"Hel'), isEmpty);
      expect(parser.add('lo"}\n'), isEmpty);
      final events = parser.add('\n');
      expect(events, hasLength(1));
      expect((events.single as AskAiSseToken).content, 'Hello');
    });

    test('several events in one chunk all come out, in order', () {
      final parser = SseEventParser();
      final events = parser.add(
        'data: {"type":"start"}\n\n'
        'data: {"type":"token","content":"a"}\n\n'
        'data: {"type":"token","content":"b"}\n\n'
        'data: {"type":"citations","citations":[{"timestamp":"0:05","content":"hi","senderId":-1,"transcriptId":9}]}\n\n'
        'data: {"type":"done","content":"ab"}\n\n',
      );
      expect(events.map((e) => e.runtimeType), [
        AskAiSseStart,
        AskAiSseToken,
        AskAiSseToken,
        AskAiSseCitations,
        AskAiSseDone,
      ]);
      final citation = (events[3] as AskAiSseCitations).citations.single;
      expect(citation.transcriptId, 9);
      expect(citation.isClient, isTrue);
      expect((events[4] as AskAiSseDone).content, 'ab');
    });

    test('the "\\n\\n" separator itself can be split across chunks', () {
      final parser = SseEventParser();
      expect(parser.add('data: {"type":"token","content":"x"}\n'), isEmpty);
      expect(parser.add('\ndata: {"type":"tok'), hasLength(1));
      expect(parser.add('en","content":"y"}\n\n'), hasLength(1));
    });

    test('[DONE] sentinels, comments and non-JSON lines are skipped, as RN does', () {
      final parser = SseEventParser();
      final events = parser.add(
        ': keep-alive\n\n'
        'data: [DONE]\n\n'
        'event: message\ndata: {"type":"token","content":"z"}\n\n'
        'data: {"type":"mystery"}\n\n',
      );
      expect(events, hasLength(1));
      expect((events.single as AskAiSseToken).content, 'z');
    });

    test('an unterminated last event is recovered by flush() at end of stream', () {
      final parser = SseEventParser();
      expect(parser.add('data: {"type":"done","content":"tail"}'), isEmpty);
      expect(parser.hasPending, isTrue);
      final events = parser.flush();
      expect((events.single as AskAiSseDone).content, 'tail');
      expect(parser.flush(), isEmpty);
    });

    test('error events carry their message', () {
      final events = SseEventParser().add('data: {"type":"error","error":"Rate limited"}\n\n');
      expect((events.single as AskAiSseError).error, 'Rate limited');
    });
  });

  group('AskAiMarkdown.linkTimestamps', () {
    const citations = [AskAiCitation(timestamp: '4:12', content: 'x', senderId: 3, transcriptId: 77)];

    test('a resolved timestamp becomes a moment link; an unresolved one stays literal', () {
      final out = AskAiMarkdown.linkTimestamps('At [4:12] and [9:99] you paused.', citations, enabled: true);
      expect(out, contains('(ask-ai-moment:77)'));
      expect(out, contains('[9:99]'));
    });

    test('nothing is linked when there is no transcript to open', () {
      const text = 'At [4:12] you paused.';
      expect(AskAiMarkdown.linkTimestamps(text, citations, enabled: false), text);
    });
  });
}
