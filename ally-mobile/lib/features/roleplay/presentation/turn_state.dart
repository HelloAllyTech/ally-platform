/// Mirrors RN's `TurnState` enum (`src/types/simulations.ts`) — which pill
/// label a `ParticipantTile` shows. `idle` renders nothing (RN's
/// `TurnIndicator` returns `null` for it).
enum TurnState { aiSpeaking, aiListening, userTurnToSpeak, userTurnToListen, thinking, paused, idle }

/// Direct port of RN's `remoteTurnState`/`localTurnState` memo
/// (`SimulationAssistantScreen.tsx`) — confirmed from source line-by-line,
/// including the one non-obvious branch: while the agent is [thinking],
/// [local] stays `idle` (RN's `local` variable is simply never reassigned
/// in that branch), it is NOT `userTurnToListen` like the
/// `debouncedRemoteSpeaking` branch below it.
({TurnState remote, TurnState local}) deriveTurnStates({
  required bool isPaused,
  required bool isThinking,
  required bool debouncedRemoteSpeaking,
  required bool isLocalSpeaking,
}) {
  // While paused, both tiles show "Paused" — the underlying speaking/
  // thinking/your-turn status is frozen and would otherwise be stale and
  // misleading.
  if (isPaused) return (remote: TurnState.paused, local: TurnState.paused);

  if (isThinking) return (remote: TurnState.thinking, local: TurnState.idle);
  if (debouncedRemoteSpeaking) {
    return (remote: TurnState.aiSpeaking, local: TurnState.userTurnToListen);
  }
  if (isLocalSpeaking) return (remote: TurnState.aiListening, local: TurnState.idle);
  return (remote: TurnState.aiListening, local: TurnState.userTurnToSpeak);
}

/// Mirrors RN's `TurnIndicator`'s `getLabelKey` — `null` for [TurnState.idle]
/// renders nothing, same as RN returning `null`/an empty label.
String? turnStateLabelKey(TurnState state) => switch (state) {
  TurnState.aiSpeaking => 'simulationPage.turnIndicator.speaking',
  TurnState.aiListening => 'simulationPage.turnIndicator.listening',
  TurnState.userTurnToSpeak => 'simulationPage.turnIndicator.yourTurnToSpeak',
  TurnState.userTurnToListen => 'simulationPage.turnIndicator.yourTurnToListen',
  TurnState.thinking => 'simulationPage.turnIndicator.thinking',
  TurnState.paused => 'simulationPage.turnIndicator.paused',
  TurnState.idle => null,
};
