/// Pause/resume control-channel message types — mirrors RN's `SIM_CONTROL`
/// (`SimulationAssistantScreen.tsx`). Client→agent: [pause]/[resume].
/// Agent→client: the rest.
class SimControl {
  SimControl._();

  static const pause = 'pause';
  static const resume = 'resume';
  static const paused = 'paused';
  static const resumed = 'resumed';
  static const capWarning = 'cap-warning';
  static const capEnded = 'cap-ended';
}

/// If the agent doesn't ack a pause/resume within this window, the
/// optimistic UI reverts — mirrors RN's `CONTROL_ACK_TIMEOUT_MS`.
const controlAckTimeout = Duration(milliseconds: 2500);

/// Direct port of RN's authoritative ack-reconciliation guard (the
/// `onDataReceived` branch for `'paused'`/`'resumed'`) — confirmed from
/// source line-by-line. Returns the new paused-bookkeeping state, or `null`
/// when the ack already matches [currentIsPaused] (the common case: the
/// optimistic toggle already applied this exact change, so the ack is pure
/// confirmation with nothing left to reconcile). Only diverges from `null`
/// to self-heal a desync — a late ack arriving after an optimistic revert
/// already fired, or a pause/resume the agent initiated unprompted.
({bool isPaused, Duration pausedOffsetMs, DateTime? pauseStartedAt})? reconcilePauseAck({
  required bool agentPaused,
  required bool currentIsPaused,
  required Duration currentPausedOffsetMs,
  required DateTime? currentPauseStartedAt,
  required DateTime now,
}) {
  if (agentPaused && !currentIsPaused) {
    return (
      isPaused: true,
      pausedOffsetMs: currentPausedOffsetMs,
      pauseStartedAt: currentPauseStartedAt ?? now,
    );
  }
  if (!agentPaused && currentIsPaused) {
    final banked = currentPauseStartedAt != null ? now.difference(currentPauseStartedAt) : Duration.zero;
    return (
      isPaused: false,
      pausedOffsetMs: currentPausedOffsetMs + banked,
      pauseStartedAt: null,
    );
  }
  return null;
}
