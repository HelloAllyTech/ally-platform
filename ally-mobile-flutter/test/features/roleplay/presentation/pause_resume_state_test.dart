import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/roleplay/presentation/pause_resume_state.dart';

void main() {
  final now = DateTime(2026, 1, 1, 12, 0, 10);

  group('reconcilePauseAck', () {
    test('a "paused" ack arriving after the optimistic pause already applied it is a no-op', () {
      final result = reconcilePauseAck(
        agentPaused: true,
        currentIsPaused: true, // optimistic path already set this
        currentPausedOffsetMs: Duration.zero,
        currentPauseStartedAt: DateTime(2026, 1, 1, 12, 0, 5),
        now: now,
      );

      expect(result, isNull, reason: 'no banking should happen twice for the same pause');
    });

    test('a "resumed" ack arriving after the optimistic resume already applied it is a no-op', () {
      final result = reconcilePauseAck(
        agentPaused: false,
        currentIsPaused: false, // optimistic path already resumed + banked
        currentPausedOffsetMs: const Duration(seconds: 5),
        currentPauseStartedAt: null,
        now: now,
      );

      expect(result, isNull);
    });

    test('self-heals a desync: agent says paused but the client thinks it is not', () {
      final result = reconcilePauseAck(
        agentPaused: true,
        currentIsPaused: false,
        currentPausedOffsetMs: Duration.zero,
        currentPauseStartedAt: null,
        now: now,
      );

      expect(result!.isPaused, isTrue);
      expect(result.pauseStartedAt, now, reason: 'stamps a start time since there was none yet');
      expect(result.pausedOffsetMs, Duration.zero, reason: 'nothing banked yet on the way in');
    });

    test(
      'self-heals a desync: agent says resumed but the client thinks it is still paused — '
      'banks the elapsed pause',
      () {
        final pausedAt = DateTime(2026, 1, 1, 12, 0, 2);

        final result = reconcilePauseAck(
          agentPaused: false,
          currentIsPaused: true,
          currentPausedOffsetMs: const Duration(seconds: 10),
          currentPauseStartedAt: pausedAt,
          now: now,
        );

        expect(result!.isPaused, isFalse);
        expect(result.pausedOffsetMs, const Duration(seconds: 18)); // 10 + (12:00:10 - 12:00:02)
        expect(result.pauseStartedAt, isNull);
      },
    );

    test('a resume-desync ack with no recorded pause-start still clears cleanly (banks nothing)', () {
      final result = reconcilePauseAck(
        agentPaused: false,
        currentIsPaused: true,
        currentPausedOffsetMs: const Duration(seconds: 3),
        currentPauseStartedAt: null,
        now: now,
      );

      expect(result!.pausedOffsetMs, const Duration(seconds: 3));
      expect(result.pauseStartedAt, isNull);
    });
  });
}
