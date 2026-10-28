import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';
import 'package:livekit_client/livekit_client.dart' show Participant;
import 'package:permission_handler/permission_handler.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/realtime/livekit_room_service.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../../simulations/data/simulation_models.dart';
import '../../simulations/data/simulations_repository.dart';
import 'live_feedback_toast.dart';
import 'participant_tile.dart';
import 'pause_resume_state.dart';
import 'session_info_tabs.dart';
import 'session_score_meter.dart';
import 'turn_state.dart';

/// Mirrors ally-mobile (React Native)'s `SESSION_AUTO_END_MINUTES` fallback
/// and `parseMaxTimeSec` util — an "HH:MM:SS" string parsed to total
/// seconds, defaulting to 20 minutes when absent/malformed.
int _parseMaxTimeSec(String? timeStr) {
  if (timeStr == null || timeStr.isEmpty) return 20 * 60;
  final parts = timeStr.split(':').map((p) => int.tryParse(p) ?? 0).toList();
  final hours = parts.isNotEmpty ? parts[0] : 0;
  final minutes = parts.length > 1 ? parts[1] : 0;
  final seconds = parts.length > 2 ? parts[2] : 0;
  return hours * 3600 + minutes * 60 + seconds;
}

String _formatDuration(Duration d) {
  String pad(int n) => n.toString().padLeft(2, '0');
  return '${pad(d.inMinutes.remainder(60))}:${pad(d.inSeconds.remainder(60))}';
}

/// Phase 1's other half: live roleplay voice, mirroring ally-mobile (React
/// Native)'s `SimulationAssistantScreen.tsx`. Beyond the original Phase 1
/// connection proof (connect/mic/disconnect/background-audio), this now
/// also ports the screen's session-management chrome: the fixed 3-2-1 start
/// countdown, a running session-duration timer with a 30s-remaining warning
/// dialog (`EndingSoonModal`) and a client-side auto-end grace fallback, an
/// "End Simulation?" confirmation on leaving (system back or the header
/// back button — the explicit End-session button itself still ends
/// immediately, matching RN exactly), a focus-mode toggle, and a
/// scenario-info overlay (title + trigger warnings).
///
/// Also ports: the live `SessionChecklist`/Reminders/Description tab bar
/// (`session_info_tabs.dart`, populated from the agent's
/// `detected_event_ids` LiveKit data-channel messages); two
/// [ParticipantTile]s (confirmed audio-only — RN renders no video anywhere
/// in the app) with a speaking-driven border/pulse and a [TurnIndicator]
/// -style pill (`turn_state.dart`'s `deriveTurnStates`, fed by `AGENT_STATE`
/// messages and LiveKit's native `ActiveSpeakersChangedEvent`); a
/// [SessionScoreMeter] accumulated from each message's `data.score`; an
/// in-call coaching toast (`live_feedback_toast.dart`, from the SAME
/// message's `data.message`/`data.emoji`, gated the same
/// `!hasChecklist && !isFocusMode` way RN's `LiveFeedback` is — RN never
/// auto-dismisses it either, a new message just replaces the old one); and
/// pause/resume (`pause_resume_state.dart`) — an optimistic toggle with a
/// 2.5s ack-timeout revert and an authoritative ack-reconciliation guard
/// that self-heals any client/agent desync, confirmed line-by-line against
/// RN's `handleTogglePause`/`onDataReceived` ack branch. The paused-time
/// ledger (`_pausedOffsetMs`/`_pauseStartedAt`) freezes the on-screen
/// session timer while paused without touching the server's own
/// authoritative pause billing. `cap-warning` (a server-side max-pause
/// timeout) reuses the existing `EndingSoonModal`, matching RN exactly;
/// `cap-ended` is a no-op client-side (the agent's own shutdown triggers
/// the ordinary disconnect flow).
class RoleplayVoiceScreen extends ConsumerStatefulWidget {
  const RoleplayVoiceScreen({
    super.key,
    required this.liveKitServerUrl,
    required this.accessToken,
    this.scenarioSessionId,
    this.scenario,
    this.now = DateTime.now,
  });

  final String liveKitServerUrl;
  final String accessToken;
  final String? scenarioSessionId;

  /// Carries the timer/focus-mode/scenario-info config this screen's
  /// session-management chrome needs (`maxTimeValue`, `experienceMode`,
  /// `title`, `triggerWarnings`) — threaded through from
  /// `SimulationDetailsScreen._startSimulation`'s already-in-hand `Scenario`.
  /// `pauseEnabled` is read here too but has no control to gate yet (see the
  /// class doc on pause/resume).
  final Scenario? scenario;

  /// Injectable clock for the session timer, so tests can assert on a
  /// specific elapsed duration without a real wall-clock wait — the
  /// `Timer.periodic` tick itself still fires on fake-cleared virtual time
  /// via `tester.pump(duration)`, but `DateTime.now()` is a real-wall-clock
  /// read the test clock can't fast-forward on its own (same class of fix as
  /// `CallSummaryScreen`'s injectable `now`).
  final DateTime Function() now;

  @override
  ConsumerState<RoleplayVoiceScreen> createState() =>
      _RoleplayVoiceScreenState();
}

class _RoleplayVoiceScreenState extends ConsumerState<RoleplayVoiceScreen> {
  static const _warningThresholdSeconds = 30;
  static const _clientAutoEndGraceSeconds = 15;

  bool _isConnected = false;
  bool _isMicEnabled = false;
  bool _isEnding = false;
  String? _error;

  int? _countdownStep;
  final _countdownTimers = <Timer>[];

  DateTime? _startTime;
  // A notifier, not screen state: the tick fires every second for the
  // whole session, and a setState here rebuilt the entire screen
  // (participant tiles, the scenario HTML, the checklist) just to change
  // the duration label.
  final _elapsed = ValueNotifier(Duration.zero);
  Timer? _tickTimer;
  bool _hasWarned = false;
  bool _showEndingSoon = false;

  bool _isFocusMode = false;
  bool _showScenarioInfo = false;
  bool _showEndConfirmation = false;

  // Resolved once up front (not via `ref.read(...)` inside `dispose()`
  // itself) per Riverpod's own guidance: reading a provider in `dispose()`
  // is unsafe once the widget is mid-unmount, since `BuildContext`/`ref`
  // may already be invalid — reliably reproducible by unmounting this
  // screen in a widget test (see roleplay_voice_screen_dispose_test.dart),
  // which is exactly how this was found.
  late final LiveKitRoomService _liveKitService;
  StreamSubscription<LiveKitDataMessage>? _dataSubscription;
  StreamSubscription<List<Participant>>? _activeSpeakersSubscription;
  final Set<String> _detectedEventIds = {};
  int _score = 0;

  // In-call coaching toast — mirrors RN's `feedback`/`feedbackKey` state,
  // fed by the same live-event payload as `_score`/`_detectedEventIds`.
  // `_feedbackKey` increments on every new message so `LiveFeedbackToast`
  // gets a fresh `ValueKey` each time and replays its entrance animation,
  // matching RN's own remount-via-`key={feedbackKey}` behavior.
  String? _feedbackMessage;
  String? _feedbackEmoji;
  int _feedbackKey = 0;

  // Turn-taking — mirrors RN's `agentTurnStatus`/`remoteParticipant.
  // isSpeaking`/`localParticipant.isSpeaking`, fed into `deriveTurnStates`.
  String? _agentTurnStatus;
  bool _localSpeaking = false;
  bool _remoteSpeaking = false;
  bool _debouncedRemoteSpeaking = false;
  Timer? _remoteSpeakingDebounceTimer;

  // Pause/resume ledger — see `pause_resume_state.dart`.
  bool _isPaused = false;
  Duration _pausedOffsetMs = Duration.zero;
  DateTime? _pauseStartedAt;
  Timer? _controlAckTimer;

  bool get _showFocusButton => widget.scenario?.experienceMode != 'NONE';
  bool get _showPauseButton => widget.scenario?.pauseEnabled == true;

  ({TurnState remote, TurnState local}) get _turnStates => deriveTurnStates(
    isPaused: _isPaused,
    isThinking: _agentTurnStatus == 'thinking',
    debouncedRemoteSpeaking: _debouncedRemoteSpeaking,
    isLocalSpeaking: _localSpeaking,
  );

  @override
  void initState() {
    super.initState();
    _liveKitService = ref.read(liveKitRoomServiceProvider);
  }

  @override
  void dispose() {
    for (final timer in _countdownTimers) {
      timer.cancel();
    }
    _tickTimer?.cancel();
    _elapsed.dispose();
    _remoteSpeakingDebounceTimer?.cancel();
    _controlAckTimer?.cancel();
    _dataSubscription?.cancel();
    _activeSpeakersSubscription?.cancel();
    _liveKitService.disconnect();
    super.dispose();
  }

  /// Mirrors RN's `onDataReceived` (`SimulationAssistantScreen.tsx`) —
  /// confirmed from source, same cascading-branch structure: `AGENT_STATE`
  /// drives turn-taking; `'paused'`/`'resumed'` are authoritative acks
  /// reconciled via [reconcilePauseAck]; `'cap-warning'` reuses the ordinary
  /// session-time-limit warning dialog; `'cap-ended'` is a no-op (the
  /// agent's own shutdown triggers the normal disconnect flow); anything
  /// else falls through to the live-event payload's `detected_event_ids`
  /// (checklist) and `score` (score meter) — both on the SAME message, same
  /// as RN accumulating both from one `LiveEventPayload`.
  void _handleDataMessage(LiveKitDataMessage message) {
    final json = message.json;
    if (json == null) return;
    final type = json['type'];

    if (type == 'AGENT_STATE') {
      final state = json['state'];
      if (state == 'thinking') {
        setState(() => _agentTurnStatus = 'thinking');
      } else if (state == 'done_thinking') {
        if (_agentTurnStatus != 'speaking') {
          setState(() => _agentTurnStatus = 'user_turn');
        }
      } else if (state == 'speaking') {
        setState(() => _agentTurnStatus = 'speaking');
      }
      return;
    }

    if (type == SimControl.paused || type == SimControl.resumed) {
      _controlAckTimer?.cancel();
      _controlAckTimer = null;
      final result = reconcilePauseAck(
        agentPaused: type == SimControl.paused,
        currentIsPaused: _isPaused,
        currentPausedOffsetMs: _pausedOffsetMs,
        currentPauseStartedAt: _pauseStartedAt,
        now: widget.now(),
      );
      if (result != null) {
        setState(() {
          _isPaused = result.isPaused;
          _pausedOffsetMs = result.pausedOffsetMs;
          _pauseStartedAt = result.pauseStartedAt;
        });
        _liveKitService.setMicrophoneEnabled(result.isPaused ? false : _isMicEnabled);
      }
      return;
    }

    if (type == SimControl.capWarning) {
      setState(() => _showEndingSoon = true);
      return;
    }
    if (type == SimControl.capEnded) return;

    final data = json['data'];
    if (data is! Map<String, dynamic>) return;
    final detectedIds = data['detected_event_ids'];
    if (detectedIds is List) {
      setState(() => _detectedEventIds.addAll(detectedIds.cast<String>()));
    }
    final score = data['score'];
    if (score is num) {
      setState(() => _score += score.round());
    }
    final feedbackMessage = data['message'];
    if (feedbackMessage is String && feedbackMessage.isNotEmpty) {
      setState(() {
        _feedbackMessage = feedbackMessage;
        _feedbackEmoji = data['emoji'] is String ? data['emoji'] as String : null;
        _feedbackKey++;
      });
    }
  }

  /// Mirrors LiveKit's own `ActiveSpeakersChangedEvent` → RN's per-tile
  /// `useAudioLevel`/`isSpeaking`, one native signal standing in for both
  /// the tile's visual highlight and (via the 1500ms debounce below, for
  /// the remote participant only) the turn-state label — RN keeps these as
  /// two separate mechanisms (a 100ms-polled `audioLevel` for the tile,
  /// `ParticipantEvent.IsSpeakingChanged` debounced for the label); this
  /// port uses the one SDK-native speaking signal for both, since there's
  /// no separate polling need once LiveKit already exposes `isSpeaking`.
  void _handleActiveSpeakers(List<Participant> speakers) {
    final local = _liveKitService.room.localParticipant;
    final isLocalSpeaking = local != null && speakers.contains(local);
    final isRemoteSpeaking = speakers.any((p) => p != local);

    if (isLocalSpeaking != _localSpeaking) {
      setState(() => _localSpeaking = isLocalSpeaking);
    }
    if (isRemoteSpeaking != _remoteSpeaking) {
      setState(() => _remoteSpeaking = isRemoteSpeaking);
    }

    // Debounce remote speaking to avoid flicker on natural pauses — matches
    // RN's own comment and 1500ms value exactly.
    if (isRemoteSpeaking) {
      _remoteSpeakingDebounceTimer?.cancel();
      _remoteSpeakingDebounceTimer = null;
      if (!_debouncedRemoteSpeaking) setState(() => _debouncedRemoteSpeaking = true);
    } else {
      _remoteSpeakingDebounceTimer?.cancel();
      _remoteSpeakingDebounceTimer = Timer(const Duration(milliseconds: 1500), () {
        if (mounted) setState(() => _debouncedRemoteSpeaking = false);
      });
    }
  }

  /// Direct port of RN's `handleTogglePause` — confirmed from source
  /// line-by-line, including the optimistic-before-send ordering (the mic
  /// is really disabled/restored immediately, not after an ack) and the
  /// [revert] closures `_armControlAck` runs if no ack lands in time.
  Future<void> _togglePause() async {
    if (!_isPaused) {
      final prePauseMicEnabled = _isMicEnabled;
      void revert() {
        if (!mounted) return;
        setState(() {
          _pauseStartedAt = null;
          _isPaused = false;
        });
        _liveKitService.setMicrophoneEnabled(prePauseMicEnabled);
      }

      await _liveKitService.setMicrophoneEnabled(false);
      setState(() {
        _pauseStartedAt = widget.now();
        _isPaused = true;
      });
      await _liveKitService.publishData({'type': SimControl.pause});
      _armControlAck(revert);
    } else {
      final pausedAt = _pauseStartedAt;
      final prevOffset = _pausedOffsetMs;
      void revert() {
        if (!mounted) return;
        setState(() {
          _pausedOffsetMs = prevOffset;
          _pauseStartedAt = pausedAt ?? widget.now();
          _isPaused = true;
        });
        _liveKitService.setMicrophoneEnabled(false);
      }

      await _liveKitService.setMicrophoneEnabled(_isMicEnabled);
      setState(() {
        if (pausedAt != null) {
          _pausedOffsetMs = prevOffset + widget.now().difference(pausedAt);
        }
        _pauseStartedAt = null;
        _isPaused = false;
        _showEndingSoon = false;
      });
      await _liveKitService.publishData({'type': SimControl.resume});
      _armControlAck(revert);
    }
  }

  void _armControlAck(VoidCallback revert) {
    _controlAckTimer?.cancel();
    _controlAckTimer = Timer(controlAckTimeout, () {
      _controlAckTimer = null;
      revert();
      if (mounted) setState(() => _error = ref.tr('errors.pauseControl'));
    });
  }

  Future<void> _connect() async {
    setState(() => _error = null);

    final micStatus = await Permission.microphone.request();
    if (!micStatus.isGranted) {
      setState(() => _error = ref.tr('errors.permission'));
      return;
    }

    try {
      await _liveKitService.connect(
        liveKitServerUrl: widget.liveKitServerUrl,
        accessToken: widget.accessToken,
      );
      await _liveKitService.setMicrophoneEnabled(true);
      _dataSubscription = _liveKitService.dataMessages.listen(
        _handleDataMessage,
      );
      _activeSpeakersSubscription = _liveKitService.activeSpeakers.listen(
        _handleActiveSpeakers,
      );
      setState(() {
        _isConnected = true;
        _isMicEnabled = true;
      });
      _startCountdown();
    } catch (e) {
      setState(() => _error = '${ref.tr('errors.connect')}: $e');
    }
  }

  /// Fixed 3-2-1 overlay, unconditional once connected — mirrors RN's own
  /// comment: it "gates the switch into the live call UI" regardless of how
  /// fast the room/agent actually joins. Scoped here to start once this
  /// app's own connect step finishes (RN's screen starts it on mount, but
  /// that mount already implies an established connection; this screen's
  /// own "mount" is the pre-connect permission/Connect-button step, so the
  /// equivalent "now entering the live call" moment is connection success,
  /// not initial mount).
  void _startCountdown() {
    setState(() => _countdownStep = 3);
    _countdownTimers.addAll([
      Timer(const Duration(seconds: 1), () {
        if (mounted) setState(() => _countdownStep = 2);
      }),
      Timer(const Duration(seconds: 2), () {
        if (mounted) setState(() => _countdownStep = 1);
      }),
      Timer(const Duration(seconds: 3), () {
        if (mounted) setState(() => _countdownStep = null);
        _startTimer();
      }),
    ]);
  }

  void _startTimer() {
    _startTime = widget.now();
    _hasWarned = false;
    _tickTimer = Timer.periodic(const Duration(seconds: 1), (_) => _onTick());
  }

  void _onTick() {
    if (!mounted || _startTime == null) return;
    final rawElapsed = widget.now().difference(_startTime!);
    // Freezes while paused: `pausedTotal` grows at the same rate `rawElapsed`
    // does during an ongoing pause, so their difference stops advancing —
    // mirrors RN's own "paused time is excluded from the displayed timer
    // and the scenario time limit" comment exactly. This is the CLIENT-side
    // clock only; billing/leaderboard paused-time is tracked authoritatively
    // server-side, same as RN.
    var pausedTotal = _pausedOffsetMs;
    if (_isPaused && _pauseStartedAt != null) {
      pausedTotal += widget.now().difference(_pauseStartedAt!);
    }
    final elapsed = rawElapsed - pausedTotal;
    final maxTimeSec = _parseMaxTimeSec(widget.scenario?.maxTimeValue);
    _elapsed.value = elapsed;

    if (maxTimeSec - elapsed.inSeconds <= _warningThresholdSeconds &&
        !_hasWarned) {
      _hasWarned = true;
      setState(() => _showEndingSoon = true);
    }
    if (elapsed.inSeconds >= maxTimeSec + _clientAutoEndGraceSeconds) {
      _tickTimer?.cancel();
      _endCall();
    }
  }

  Future<void> _disconnect() async {
    _tickTimer?.cancel();
    _remoteSpeakingDebounceTimer?.cancel();
    _controlAckTimer?.cancel();
    _dataSubscription?.cancel();
    _dataSubscription = null;
    _activeSpeakersSubscription?.cancel();
    _activeSpeakersSubscription = null;
    await _liveKitService.disconnect();
    setState(() {
      _isConnected = false;
      _isMicEnabled = false;
    });
  }

  Future<void> _toggleMic() async {
    final next = !_isMicEnabled;
    await _liveKitService.setMicrophoneEnabled(next);
    setState(() => _isMicEnabled = next);
  }

  /// What the primary "end this call" action means in this scoped screen:
  /// the real end-of-scenario flow when a `scenarioSessionId` is known, or
  /// just dropping the room when there's none (the original Phase 1
  /// connection-only dev path — see the class doc). Both the main button
  /// and every dialog that lets the learner end the call from elsewhere
  /// (the warning dialog, the back-press confirmation) route through this
  /// same resolution, so neither ever silently no-ops.
  Future<void> _endCall() {
    return widget.scenarioSessionId == null ? _disconnect() : _endSession();
  }

  Future<void> _endSession() async {
    final sessionId = widget.scenarioSessionId;
    if (sessionId == null) return;
    setState(() => _isEnding = true);
    try {
      await ref
          .read(simulationsRepositoryProvider)
          .endScenarioSession(sessionId);
      await _disconnect();
      if (mounted) context.pushReplacement('/simulations/feedback/$sessionId');
    } catch (e) {
      setState(() => _error = '${ref.tr('errors.endSimulation')}: $e');
    } finally {
      if (mounted) setState(() => _isEnding = false);
    }
  }

  /// Mirrors RN's `useHardwareBackPressHandler` gate: only a session already
  /// in progress needs a confirmation — before connecting (or once already
  /// disconnected), back just leaves.
  void _handleBackPress() {
    if (_isConnected) {
      setState(() => _showEndConfirmation = true);
    } else if (mounted) {
      context.pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: !_isConnected,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop) _handleBackPress();
      },
      child: Scaffold(
        body: Stack(
          children: [
            Column(
              children: [
                TabScreenHeader(
                  title: ref.t('roleplayVoice.title'),
                  leading: IconButton(
                    icon: const Icon(Icons.arrow_back),
                    onPressed: _handleBackPress,
                  ),
                ),
                Expanded(child: _buildBody()),
              ],
            ),
            if (_showScenarioInfo && (widget.scenario?.title ?? '').isNotEmpty)
              Positioned(
                top: 16,
                left: 16,
                child: _ScenarioInfoPanel(scenario: widget.scenario!),
              ),
            if (_showEndingSoon && _isConnected)
              _ConfirmOverlay(
                title:
                    '${ref.t('simulationPage.warningDialog.titleNormal')} '
                    '${ref.t('simulationPage.warningDialog.titleItalic')}',
                description: ref.t('simulationPage.warningDialog.content'),
                primaryLabel: ref.t('common.continue'),
                onPrimary: () => setState(() => _showEndingSoon = false),
                secondaryLabel: ref.t('simulationPage.endSession'),
                onSecondary: () {
                  setState(() => _showEndingSoon = false);
                  _endCall();
                },
              ),
            if (_showEndConfirmation)
              _ConfirmOverlay(
                title:
                    '${ref.t('listeningScreen.end')}${ref.t('common.simulation')}',
                description: ref.t('simulationPage.endDialog.content'),
                primaryLabel: ref.t('common.cancel'),
                onPrimary: () => setState(() => _showEndConfirmation = false),
                secondaryLabel: ref.t('simulationPage.endSession'),
                secondaryIsDestructive: true,
                onSecondary: () {
                  setState(() => _showEndConfirmation = false);
                  _endCall();
                },
              ),
            if (_countdownStep != null)
              _CountdownOverlay(step: _countdownStep!, ref: ref),
          ],
        ),
      ),
    );
  }

  Widget _buildBody() {
    // The checklist panel makes this body taller than a typical phone
    // viewport can show without scrolling — `LayoutBuilder` +
    // `ConstrainedBox(minHeight: ...)` keeps the original vertical-centering
    // look when content is short (no checklist, or not yet connected) while
    // letting it scroll instead of overflowing once it isn't.
    return LayoutBuilder(
      builder: (context, constraints) => SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: BoxConstraints(minHeight: constraints.maxHeight - 48),
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (_isConnected)
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: ParticipantTile(
                          key: const ValueKey('participant-tile-remote'),
                          avatarUrl: widget.scenario?.coverImageUrl,
                          isSpeaking: _remoteSpeaking,
                          turnState: _turnStates.remote,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: ParticipantTile(
                          key: const ValueKey('participant-tile-local'),
                          avatarUrl: null,
                          isSpeaking: _localSpeaking,
                          turnState: _turnStates.local,
                          isMuted: !_isMicEnabled,
                        ),
                      ),
                    ],
                  )
                else
                  SvgPicture.asset('assets/icons/micOff.svg', width: 64, height: 64),
                // Checklist mode already surfaces real-time progress via its
                // own tab, so the generic coaching toast is redundant there
                // — same gate RN uses (`!hasChecklist && !isFocusMode`).
                if (_isConnected &&
                    !(widget.scenario?.hasChecklist ?? false) &&
                    !_isFocusMode &&
                    _feedbackMessage != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: LiveFeedbackToast(
                      key: ValueKey(_feedbackKey),
                      message: _feedbackMessage!,
                      emoji: _feedbackEmoji,
                    ),
                  ),
                const SizedBox(height: 16),
                Text(
                  _isConnected
                      ? ref.t('roleplayVoice.connectedToRoom')
                      : ref.t('roleplayVoice.notConnected'),
                ),
                if (_isConnected && !_isFocusMode)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: ValueListenableBuilder<Duration>(
                      valueListenable: _elapsed,
                      builder: (context, elapsed, _) => Text(
                        '${ref.t('simulationPage.sessionDuration')} ${_formatDuration(elapsed)}',
                      ),
                    ),
                  ),
                if (_isConnected && (widget.scenario?.showScoreMeter ?? true))
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: SessionScoreMeter(score: _score),
                  ),
                if (_isConnected &&
                    !_isFocusMode &&
                    widget.scenario != null &&
                    SessionInfoTabs.hasAnyTab(widget.scenario!))
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: SessionInfoTabs(
                      scenario: widget.scenario!,
                      triggeredEventIds: _detectedEventIds,
                    ),
                  ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      _error!,
                      style: const TextStyle(color: AppColors.red400),
                    ),
                  ),
                const SizedBox(height: 24),
                if (!_isConnected)
                  AppButton(
                    label: ref.t('roleplayVoice.connect'),
                    onPressed: _connect,
                  )
                else ...[
                  AppButton(
                    label: _isMicEnabled
                        ? ref.t('simulationPage.mute')
                        : ref.t('simulationPage.unmute'),
                    iconLeft: SvgPicture.asset(
                      _isMicEnabled
                          ? 'assets/icons/mic.svg'
                          : 'assets/icons/micOff.svg',
                      width: 20,
                      height: 20,
                      colorFilter: const ColorFilter.mode(
                        Colors.white,
                        BlendMode.srcIn,
                      ),
                    ),
                    onPressed: _toggleMic,
                  ),
                  if (_showPauseButton) ...[
                    const SizedBox(height: 12),
                    AppButton(
                      key: const ValueKey('pause-resume-button'),
                      label: ref.t(_isPaused ? 'simulationPage.resume' : 'simulationPage.pause'),
                      variant: AppButtonVariant.secondary,
                      onPressed: _togglePause,
                    ),
                  ],
                  if (_showFocusButton) ...[
                    const SizedBox(height: 12),
                    AppButton(
                      label: ref.t(
                        _isFocusMode
                            ? 'listeningScreen.focused'
                            : 'listeningScreen.focus',
                      ),
                      variant: AppButtonVariant.secondary,
                      onPressed: () =>
                          setState(() => _isFocusMode = !_isFocusMode),
                    ),
                  ],
                  if ((widget.scenario?.title ?? '').isNotEmpty) ...[
                    const SizedBox(height: 12),
                    AppButton(
                      label: ref.t('common.details'),
                      variant: AppButtonVariant.secondary,
                      onPressed: () => setState(
                        () => _showScenarioInfo = !_showScenarioInfo,
                      ),
                    ),
                  ],
                  const SizedBox(height: 12),
                  if (widget.scenarioSessionId != null)
                    AppButton(
                      label: ref.t('simulationPage.endSession'),
                      variant: AppButtonVariant.destructive,
                      isLoading: _isEnding,
                      onPressed: _endSession,
                    )
                  else
                    AppButton(
                      label: ref.t('roleplayVoice.disconnect'),
                      variant: AppButtonVariant.secondary,
                      onPressed: _disconnect,
                    ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Port of RN's `SimulationCountdown` — a full-screen, opaque, blocking
/// overlay stepping 3→2→1, synced with the screen's own countdown timers.
class _CountdownOverlay extends StatelessWidget {
  const _CountdownOverlay({required this.step, required this.ref});

  final int step;
  final WidgetRef ref;

  @override
  Widget build(BuildContext context) {
    return Positioned.fill(
      child: ColoredBox(
        color: Colors.black,
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 120,
                height: 120,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(color: const Color(0xFF57F646), width: 2),
                ),
                alignment: Alignment.center,
                child: Text(
                  '$step',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 48,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Text(
                ref.t('simulationPage.simulationCountdownLabel'),
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white70),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Shared shape for RN's `EndingSoonModal` (30s-remaining warning) and the
/// hardware-back-press "End Simulation?" confirmation — both are an
/// `IllustratedActionModal`/`IllustratedModal` with a title, description,
/// and two actions; this is a plain centered dialog card standing in for
/// that shared illustrated-modal component (not ported on its own, since
/// this is its only caller so far).
class _ConfirmOverlay extends StatelessWidget {
  const _ConfirmOverlay({
    required this.title,
    required this.description,
    required this.primaryLabel,
    required this.onPrimary,
    required this.secondaryLabel,
    required this.onSecondary,
    this.secondaryIsDestructive = false,
  });

  final String title;
  final String description;
  final String primaryLabel;
  final VoidCallback onPrimary;
  final String secondaryLabel;
  final VoidCallback onSecondary;
  final bool secondaryIsDestructive;

  @override
  Widget build(BuildContext context) {
    return Positioned.fill(
      child: Container(
        color: Colors.black.withValues(alpha: 0.5),
        alignment: Alignment.center,
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 360),
          child: Material(
            color: Theme.of(context).colorScheme.surface,
            borderRadius: BorderRadius.circular(16),
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    title,
                    style: Theme.of(context).textTheme.titleMedium,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 8),
                  Text(description, textAlign: TextAlign.center),
                  const SizedBox(height: 20),
                  AppButton(
                    label: secondaryLabel,
                    variant: secondaryIsDestructive
                        ? AppButtonVariant.destructive
                        : AppButtonVariant.secondary,
                    onPressed: onSecondary,
                  ),
                  const SizedBox(height: 8),
                  AppButton(label: primaryLabel, onPressed: onPrimary),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Port of RN's `ScenarioInfoOverlay` panel content (the (i)-icon toggle
/// lives inline in `_buildBody` as the "common.info" button instead of a
/// floating icon, since this scoped screen has no participant-tile corner
/// to anchor one to).
class _ScenarioInfoPanel extends ConsumerWidget {
  const _ScenarioInfoPanel({required this.scenario});

  final Scenario scenario;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Container(
      constraints: const BoxConstraints(minWidth: 200, maxWidth: 320),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.85),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            scenario.title,
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w600,
            ),
          ),
          if (scenario.triggerWarnings.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                scenario.triggerWarnings.join(' • '),
                style: const TextStyle(color: Colors.white70, fontSize: 12),
              ),
            ),
        ],
      ),
    );
  }
}
