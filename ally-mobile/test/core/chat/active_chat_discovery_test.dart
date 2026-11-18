import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/chat/active_chat_discovery.dart';
import 'package:ally_mobile_flutter/features/scribe/data/chat_models.dart';

Chat _conferenceChat({int chatId = 42}) => Chat(
  chatId: chatId,
  status: ChatStatus.active,
  provider: ChatProvider.exotelConferenceCall,
  startedAt: '2026-01-01T10:00:00Z',
);

Chat _microphoneChat({int chatId = 7}) => Chat(
  chatId: chatId,
  status: ChatStatus.active,
  provider: ChatProvider.microphone,
  startedAt: '2026-01-01T10:00:00Z',
);

void main() {
  group('isListeningRoute', () {
    test('true for /scribe and /conference-listening/*', () {
      expect(isListeningRoute('/scribe'), isTrue);
      expect(isListeningRoute('/conference-listening/42'), isTrue);
    });

    test('false for anything else', () {
      expect(isListeningRoute('/home'), isFalse);
      expect(isListeningRoute('/call-log'), isFalse);
    });
  });

  group('isExemptFromClearingCurrentChat', () {
    test('exempt: the listening screens themselves, breathing, and call summary', () {
      expect(isExemptFromClearingCurrentChat('/scribe'), isTrue);
      expect(isExemptFromClearingCurrentChat('/conference-listening/42'), isTrue);
      expect(isExemptFromClearingCurrentChat('/box-breathing'), isTrue);
      expect(isExemptFromClearingCurrentChat('/call-log/99'), isTrue);
    });

    test('not exempt: the call log LIST itself, or anywhere else', () {
      expect(isExemptFromClearingCurrentChat('/call-log'), isFalse);
      expect(isExemptFromClearingCurrentChat('/home'), isFalse);
    });
  });

  group('targetRouteForActiveChat', () {
    test('a conference-call chat routes to /conference-listening/:chatId', () {
      expect(
        targetRouteForActiveChat(_conferenceChat(chatId: 42), '/home'),
        '/conference-listening/42',
      );
    });

    test('a microphone chat routes to /scribe', () {
      expect(targetRouteForActiveChat(_microphoneChat(), '/home'), '/scribe');
    });

    test('null (no-op) when already on a listening route — mirrors RN\'s no-op-from-itself branch', () {
      expect(targetRouteForActiveChat(_conferenceChat(), '/conference-listening/42'), isNull);
      expect(targetRouteForActiveChat(_microphoneChat(), '/scribe'), isNull);
    });
  });
}
