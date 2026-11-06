import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/scribe/data/chat_models.dart';
import 'package:ally_mobile_flutter/features/scribe/data/transcript_logic.dart';

void main() {
  group('processTranscription', () {
    test('appends when there is no prior entry', () {
      final payload = Transcription(id: 1, message: 'hello', senderId: 1, timestamp: 't1');

      final result = processTranscription([], payload);

      expect(result, [payload]);
    });

    test('replaces the last entry when it is not yet final (a live partial)', () {
      final previous = [
        Transcription(
          id: 1,
          message: 'hel',
          senderId: 1,
          timestamp: 't1',
          isFinal: false,
          isSentenceComplete: false,
        ),
      ];
      final payload = Transcription(
        id: 1,
        message: 'hello',
        senderId: 1,
        timestamp: 't1',
        isFinal: false,
        isSentenceComplete: false,
      );

      final result = processTranscription(previous, payload);

      expect(result, hasLength(1));
      expect(result.single.message, 'hello');
      expect(result.single.id, 1, reason: 'keeps the original entry identity, just updates text');
    });

    test(
      'concatenates onto the last entry when it is final but the sentence is not complete, '
      'and the new payload is also final',
      () {
        final previous = [
          Transcription(
            id: 1,
            message: 'Hello there',
            senderId: 1,
            timestamp: 't1',
            isSentenceComplete: false,
          ),
        ];
        final payload = Transcription(id: 2, message: 'how are you', senderId: 1, timestamp: 't2');

        final result = processTranscription(previous, payload);

        expect(result, hasLength(1));
        expect(result.single.message, 'Hello there how are you');
        expect(result.single.isSentenceComplete, isTrue);
      },
    );

    test('appends a new entry when the last one is already final and sentence-complete', () {
      final previous = [Transcription(id: 1, message: 'Hello.', senderId: 1, timestamp: 't1')];
      final payload = Transcription(id: 2, message: 'How are you?', senderId: 1, timestamp: 't2');

      final result = processTranscription(previous, payload);

      expect(result.map((t) => t.message), ['Hello.', 'How are you?']);
    });
  });

  group('markLastTranscriptionComplete', () {
    test('marks the last entry final/sentence-complete, leaving earlier entries untouched', () {
      final previous = [
        Transcription(id: 1, message: 'a', senderId: 1, timestamp: 't1'),
        Transcription(
          id: 2,
          message: 'b',
          senderId: 1,
          timestamp: 't2',
          isFinal: false,
          isSentenceComplete: false,
        ),
      ];

      final result = markLastTranscriptionComplete(previous);

      expect(result[0].isFinal, isTrue);
      expect(result[1].isFinal, isTrue);
      expect(result[1].isSentenceComplete, isTrue);
    });

    test('is a no-op on an empty list', () {
      expect(markLastTranscriptionComplete([]), isEmpty);
    });
  });

  group('rehydrateTranscriptions', () {
    test('splits TEXT messages by senderId, reverses order, and marks all final', () {
      final messages = [
        ChatMessage(
          id: 3,
          chatId: 1,
          senderId: 2,
          type: MessageType.text,
          content: 'third',
          createdAt: 't3',
        ),
        ChatMessage(
          id: 2,
          chatId: 1,
          senderId: 1,
          type: MessageType.text,
          content: 'second',
          createdAt: 't2',
        ),
        ChatMessage(
          id: 1,
          chatId: 1,
          senderId: 1,
          type: MessageType.text,
          content: 'first',
          createdAt: 't1',
        ),
      ];

      final result = rehydrateTranscriptions(messages, 1);

      expect(result.mine.map((t) => t.message), ['first', 'second']);
      expect(result.theirs.map((t) => t.message), ['third']);
      expect(result.mine.every((t) => t.isFinal && t.isSentenceComplete), isTrue);
    });

    test('ignores non-TEXT message types (e.g. NUDGE/STAGE)', () {
      final messages = [
        ChatMessage(
          id: 1,
          chatId: 1,
          senderId: 1,
          type: MessageType.nudge,
          content: 'a nudge',
          createdAt: 't1',
        ),
      ];

      final result = rehydrateTranscriptions(messages, 1);

      expect(result.mine, isEmpty);
      expect(result.theirs, isEmpty);
    });
  });
}
