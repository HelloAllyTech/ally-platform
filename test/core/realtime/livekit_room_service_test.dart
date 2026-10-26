import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/realtime/livekit_room_service.dart';

// `connect()`, `setMicrophoneEnabled()`, and the `room` getter all touch
// livekit_client's real `Room` (`room` lazily instantiates one on first
// access), which wraps flutter_webrtc and needs real native platform
// channels the moment it's created — there is no fake/test double for
// LiveKit's SDK surface available in this repo, and building one would be
// exactly the "exhaustively mock LiveKit's SDK surface" busywork the task
// brief says to avoid. Those members, and the `liveKitRoomServiceProvider`
// wiring around them, are untestable at the unit level here.
//
// What IS real, testable logic: `isConnected` reads the private `_room`
// field directly (not the `room` getter), so it never triggers that lazy
// instantiation — and `disconnect()`/`dispose()` are both null-guarded, so
// calling them before any room was ever created is a genuine no-op branch,
// not a native call.
void main() {
  group('LiveKitRoomService', () {
    test('isConnected is false before a Room has ever been created', () {
      final service = LiveKitRoomService();

      expect(service.isConnected, isFalse);
    });

    test('disconnect() is a no-op when no Room was ever created', () async {
      final service = LiveKitRoomService();

      await service.disconnect();

      expect(service.isConnected, isFalse);
    });

    test('dispose() is a no-op (and repeatable) when no Room was ever created', () async {
      final service = LiveKitRoomService();

      await service.dispose();
      await service.dispose();

      expect(service.isConnected, isFalse);
    });
  });

  group('LiveKitDataMessage.decode', () {
    test('decodes a valid JSON object payload, preserving the topic', () {
      final raw = utf8.encode(jsonEncode({'type': 'AGENT_STATE', 'state': 'thinking'}));

      final message = LiveKitDataMessage.decode(raw, 'events');

      expect(message.topic, 'events');
      expect(message.json, {'type': 'AGENT_STATE', 'state': 'thinking'});
      expect(message.raw, raw);
    });

    test('decodes a nested checklist feedback payload', () {
      final raw = utf8.encode(
        jsonEncode({
          'data': {
            'detected_event_ids': ['evt-1', 'evt-2'],
          },
        }),
      );

      final message = LiveKitDataMessage.decode(raw, null);

      expect(message.topic, isNull);
      expect(
        (message.json?['data'] as Map<String, dynamic>)['detected_event_ids'],
        ['evt-1', 'evt-2'],
      );
    });

    test('json is null for malformed bytes, instead of throwing', () {
      final message = LiveKitDataMessage.decode(utf8.encode('not json'), 'events');

      expect(message.json, isNull);
    });

    test('json is null for valid JSON that is not an object (e.g. a bare string)', () {
      final raw = utf8.encode(jsonEncode('just a string'));

      final message = LiveKitDataMessage.decode(raw, null);

      expect(message.json, isNull);
    });
  });
}
