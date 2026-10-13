import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/realtime/socket_events.dart';

// socket_events.dart is pure data (wire-value constants, no parsing logic
// of its own — contrary to the task brief's guess, there's no `fromJson`
// here, just the event-name strings), so this is a direct, real test of the
// one thing that matters about it: the exact wire values ally-be's
// Socket.IO gateways expect, ported byte-for-byte from ally-mobile (React
// Native)'s `SocketEvent` enum. A typo here (e.g. 'SESSION_CREATED' vs
// 'SESSSION_CREATED') would silently break every listener registered
// against it — this test is what would catch that.
void main() {
  group('SocketEvent', () {
    test('wire values match ally-mobile (React Native) SocketEvent exactly', () {
      expect(SocketEvent.sendMessage, 'SEND_MESSAGE');
      expect(SocketEvent.messageReceived, 'MESSAGE_RECEIVED');
      expect(SocketEvent.audioMessage, 'AUDIO_MESSAGE');
      expect(SocketEvent.startAudioChat, 'START_AUDIO_CHAT');
      expect(SocketEvent.chatEnded, 'CHAT_ENDED');
      expect(SocketEvent.utteranceEnded, 'UTTERANCE_ENDED');
      expect(SocketEvent.userJoined, 'USER_JOINED');
      expect(SocketEvent.sessionCreated, 'SESSION_CREATED');
      expect(SocketEvent.audioChatEnded, 'AUDIO_CHAT_ENDED');
      expect(SocketEvent.nudge, 'NUDGE');
      expect(SocketEvent.scribeStartDiagnostic, 'SCRIBE_START_DIAGNOSTIC');
    });

    test('every event name is unique', () {
      final values = [
        SocketEvent.sendMessage,
        SocketEvent.messageReceived,
        SocketEvent.audioMessage,
        SocketEvent.startAudioChat,
        SocketEvent.chatEnded,
        SocketEvent.utteranceEnded,
        SocketEvent.userJoined,
        SocketEvent.sessionCreated,
        SocketEvent.audioChatEnded,
        SocketEvent.nudge,
        SocketEvent.scribeStartDiagnostic,
      ];

      expect(values.toSet(), hasLength(values.length));
    });
  });
}
