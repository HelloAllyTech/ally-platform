/// Port of ally-mobile (React Native)'s `src/hooks/useVideoWatchProgress.ts`
/// — unique-watched-seconds tracking + throttled reporting for course video
/// items. Pure logic (no Riverpod/widget dependency), same as the RN
/// original's own framework-agnostic design, so it unit-tests the same way.
library;

/// Max gap (s) between samples still counted as continuous playback.
const maxPlaybackStepSeconds = 2.0;

/// Report at most every N ms...
const reportIntervalMs = 10000;

/// ...unless the watched percentage moved by at least this much.
const reportPctDelta = 10;

class WatchTrackerState {
  final Set<int> watched = {};
  double? lastTime;
}

/// Records a playhead sample. Credits every integer second crossed since the
/// previous sample IF the step is small enough to be continuous playback —
/// larger jumps are seeks and credit nothing (the new position simply
/// becomes the anchor). Mutates [tracker].
void recordWatchSample(
  WatchTrackerState tracker,
  double time, {
  double maxStepSeconds = maxPlaybackStepSeconds,
}) {
  if (!time.isFinite || time < 0) return;
  final last = tracker.lastTime;
  if (last != null && time > last && time - last <= maxStepSeconds) {
    for (var s = last.floor(); s < time.floor(); s++) {
      tracker.watched.add(s);
    }
    tracker.watched.add(time.floor());
  }
  tracker.lastTime = time;
}

/// Percentage (0-100, rounded) of unique watched seconds vs duration.
int watchedPctFromSeconds(int uniqueSeconds, double durationSeconds) {
  if (durationSeconds <= 0) return 0;
  final pct = (uniqueSeconds / durationSeconds.floor() * 100).round();
  return pct.clamp(0, 100);
}

/// Should a new percentage be reported now? True when the pct delta since
/// the last report is >= [pctDelta], or the report interval elapsed with any
/// forward movement.
bool shouldReport(
  int lastReportedPct,
  int currentPct,
  int lastReportAtMs,
  int nowMs, {
  int intervalMs = reportIntervalMs,
  int pctDelta = reportPctDelta,
}) {
  if (currentPct <= lastReportedPct) return false;
  if (currentPct - lastReportedPct >= pctDelta) return true;
  return nowMs - lastReportAtMs >= intervalMs;
}

/// Accumulates unique watched seconds, and reports the monotonic max —
/// throttled to every 10s or a +10% jump, with a `flush()` on
/// pause/unmount. Stateful equivalent of the RN hook, built so a widget
/// can own one via `late final` instead of re-deriving hook state.
class VideoWatchProgressTracker {
  VideoWatchProgressTracker({
    required this.durationSeconds,
    required this.onReport,
    int initialMaxWatchedPct = 0,
  }) : watchedPct = initialMaxWatchedPct,
       _lastReportedPct = initialMaxWatchedPct;

  final double durationSeconds;
  final void Function(int watchedPct) onReport;

  final _tracker = WatchTrackerState();
  int watchedPct;
  int _lastReportedPct;
  int _lastReportAtMs = 0;
  bool disabled = false;

  void recordTime(double timeSeconds) {
    if (disabled) return;
    recordWatchSample(_tracker, timeSeconds);
    final pct = watchedPctFromSeconds(_tracker.watched.length, durationSeconds);
    if (pct > watchedPct) watchedPct = pct;
    _maybeReport();
  }

  void _maybeReport({bool force = false}) {
    if (disabled) return;
    final now = DateTime.now().millisecondsSinceEpoch;
    final due = force
        ? watchedPct > _lastReportedPct
        : shouldReport(_lastReportedPct, watchedPct, _lastReportAtMs, now);
    if (due) {
      _lastReportedPct = watchedPct;
      _lastReportAtMs = now;
      onReport(watchedPct);
    }
  }

  /// Force-send the current max immediately (pause/dispose).
  void flush() => _maybeReport(force: true);
}
