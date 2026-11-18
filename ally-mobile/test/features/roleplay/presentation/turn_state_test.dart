import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/roleplay/presentation/turn_state.dart';

void main() {
  group('deriveTurnStates', () {
    test('paused overrides everything else — both tiles show paused', () {
      final result = deriveTurnStates(
        isPaused: true,
        isThinking: true,
        debouncedRemoteSpeaking: true,
        isLocalSpeaking: true,
      );

      expect(result.remote, TurnState.paused);
      expect(result.local, TurnState.paused);
    });

    test('thinking: remote shows thinking, local stays idle (not userTurnToListen)', () {
      final result = deriveTurnStates(
        isPaused: false,
        isThinking: true,
        debouncedRemoteSpeaking: false,
        isLocalSpeaking: false,
      );

      expect(result.remote, TurnState.thinking);
      expect(result.local, TurnState.idle);
    });

    test('remote (debounced) speaking: remote speaking, local told to listen', () {
      final result = deriveTurnStates(
        isPaused: false,
        isThinking: false,
        debouncedRemoteSpeaking: true,
        isLocalSpeaking: false,
      );

      expect(result.remote, TurnState.aiSpeaking);
      expect(result.local, TurnState.userTurnToListen);
    });

    test('local speaking (and remote not): remote listening, local idle', () {
      final result = deriveTurnStates(
        isPaused: false,
        isThinking: false,
        debouncedRemoteSpeaking: false,
        isLocalSpeaking: true,
      );

      expect(result.remote, TurnState.aiListening);
      expect(result.local, TurnState.idle);
    });

    test('nobody speaking/thinking: remote listening, local prompted to speak', () {
      final result = deriveTurnStates(
        isPaused: false,
        isThinking: false,
        debouncedRemoteSpeaking: false,
        isLocalSpeaking: false,
      );

      expect(result.remote, TurnState.aiListening);
      expect(result.local, TurnState.userTurnToSpeak);
    });
  });

  group('turnStateLabelKey', () {
    test('idle has no label (renders nothing)', () {
      expect(turnStateLabelKey(TurnState.idle), isNull);
    });

    test('every other state has a non-null key', () {
      for (final state in TurnState.values.where((s) => s != TurnState.idle)) {
        expect(turnStateLabelKey(state), isNotNull, reason: '$state should have a label key');
      }
    });
  });
}
