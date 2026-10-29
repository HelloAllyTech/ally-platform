import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/scribe/data/chat_models.dart';

void main() {
  group('Chat.fromJson', () {
    test('parses messages and platform', () {
      final chat = Chat.fromJson({
        'chatId': 1,
        'status': 'ACTIVE',
        'provider': 'MICROPHONE',
        'startedAt': '2026-01-01T00:00:00Z',
        'platform': 'MOBILE',
        'messages': [
          {
            'id': 1,
            'chatId': 1,
            'senderId': 1,
            'type': 'TEXT',
            'content': 'hi',
            'createdAt': '2026-01-01T00:00:01Z',
          },
        ],
      });

      expect(chat.platform, 'MOBILE');
      expect(chat.messages, hasLength(1));
      expect(chat.messages.single.content, 'hi');
    });

    test('messages defaults to empty when absent', () {
      final chat = Chat.fromJson({
        'chatId': 1,
        'status': 'ACTIVE',
        'provider': 'MICROPHONE',
        'startedAt': '2026-01-01T00:00:00Z',
      });

      expect(chat.messages, isEmpty);
    });
  });

  group('Chat.isWebMicrophoneMode', () {
    test('is true only for a MICROPHONE chat on the WEB platform', () {
      final webMicrophone = Chat.fromJson({
        'chatId': 1,
        'status': 'ACTIVE',
        'provider': 'MICROPHONE',
        'startedAt': '2026-01-01T00:00:00Z',
        'platform': 'WEB',
      });
      final mobileMicrophone = Chat.fromJson({
        'chatId': 1,
        'status': 'ACTIVE',
        'provider': 'MICROPHONE',
        'startedAt': '2026-01-01T00:00:00Z',
        'platform': 'MOBILE',
      });
      final webConference = Chat.fromJson({
        'chatId': 1,
        'status': 'ACTIVE',
        'provider': 'EXOTEL_CONFERENCE_CALL',
        'startedAt': '2026-01-01T00:00:00Z',
        'platform': 'WEB',
      });

      expect(webMicrophone.isWebMicrophoneMode, isTrue);
      expect(mobileMicrophone.isWebMicrophoneMode, isFalse);
      expect(webConference.isWebMicrophoneMode, isFalse);
    });
  });
}
