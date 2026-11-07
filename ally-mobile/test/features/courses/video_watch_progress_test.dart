import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/courses/data/video_watch_progress.dart';

void main() {
  group('recordWatchSample (unique watched seconds)', () {
    test('credits every integer second crossed during continuous playback', () {
      final tracker = WatchTrackerState();
      recordWatchSample(tracker, 0);
      recordWatchSample(tracker, 1);
      recordWatchSample(tracker, 2);
      expect(tracker.watched.length, 3);
    });

    test('does not credit a forward seek (jump larger than the step)', () {
      final tracker = WatchTrackerState();
      recordWatchSample(tracker, 0);
      recordWatchSample(tracker, 50);
      expect(tracker.watched.length, 0);
      recordWatchSample(tracker, 51);
      expect(tracker.watched.contains(50), true);
    });

    test('counts a re-watched second only once', () {
      final tracker = WatchTrackerState();
      recordWatchSample(tracker, 0);
      recordWatchSample(tracker, 1);
      recordWatchSample(tracker, 2);
      tracker.lastTime = 0;
      recordWatchSample(tracker, 1);
      recordWatchSample(tracker, 2);
      expect(tracker.watched.length, 3);
    });

    test('ignores non-finite / negative samples', () {
      final tracker = WatchTrackerState();
      recordWatchSample(tracker, double.nan);
      recordWatchSample(tracker, -5);
      expect(tracker.watched.length, 0);
      expect(tracker.lastTime, null);
    });
  });

  group('watchedPctFromSeconds', () {
    test('is 0 for a zero/invalid duration', () {
      expect(watchedPctFromSeconds(10, 0), 0);
      expect(watchedPctFromSeconds(10, -1), 0);
    });

    test('computes a rounded, clamped percentage', () {
      expect(watchedPctFromSeconds(50, 100), 50);
      expect(watchedPctFromSeconds(1, 3), 33);
      expect(watchedPctFromSeconds(200, 100), 100);
    });
  });

  group('shouldReport', () {
    test('never reports a non-increasing percentage', () {
      expect(shouldReport(40, 40, 0, 100000), false);
      expect(shouldReport(40, 30, 0, 100000), false);
    });

    test('reports immediately when the delta meets the threshold', () {
      expect(shouldReport(0, 10, 0, 0), true);
    });

    test('reports on interval elapse even for a small delta', () {
      expect(shouldReport(0, 5, 0, 11000), true);
      expect(shouldReport(0, 5, 0, 5000), false);
    });
  });

  group('VideoWatchProgressTracker', () {
    test('tracks the monotonic max watched pct from recorded samples', () {
      final reports = <int>[];
      // A long duration keeps each 1s sample's delta well under the 10%
      // report threshold, isolating what this test actually checks: pct
      // accumulation. The interval/delta gating itself is covered above
      // (shouldReport is real-wall-clock-timed in the tracker, same as the
      // RN hook, so it isn't re-asserted here — no RN test does either).
      final tracker = VideoWatchProgressTracker(durationSeconds: 1000, onReport: reports.add);
      for (var t = 0.0; t <= 4; t++) {
        tracker.recordTime(t);
      }
      expect(tracker.watchedPct, 1); // 5/1000 rounds to 1%.

      // A disabled tracker (item already completed) records nothing further.
      tracker.disabled = true;
      tracker.recordTime(500);
      expect(tracker.watchedPct, 1);
    });
  });
}
