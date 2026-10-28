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
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/rn_scale.dart';
import '../../../core/widgets/app_button.dart';
import '../../simulations/data/simulation_models.dart';
import '../../simulations/data/simulations_repository.dart';
import '../../simulations/presentation/simulation_feedback_location.dart';
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
    this.pathId,
    this.caseId,
    this.languageId,
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

  /// RN route params `pathId`/`caseId`/`languageId`, passed on to Feedback.
  final String? pathId;
  final String? caseId;
  final int? languageId;

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
      if (mounted) {
        context.pushReplacement(simulationFeedbackLocation(
          sessionId,
          pathId: widget.pathId,
          caseId: widget.caseId,
          languageId: widget.languageId,
        ));
      }
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

  /// RN `isControlButtonMaximized` (starts collapsed).
  bool _controlsMaximized = false;

  bool get _hasTabs => widget.scenario != null && SessionInfoTabs.hasAnyTab(widget.scenario!);

  @override
  Widget build(BuildContext context) {
    final inProgress = _isConnected;
    return PopScope(
      canPop: !_isConnected,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop) _handleBackPress();
      },
      child: Scaffold(
        // RN: a full-bleed dark call screen (`ds.grey[950]`) with no header;
        // leaving is the hardware back / End session.
        backgroundColor: AppColors.grey950,
        body: Stack(
          children: [
            SafeArea(
              child: Column(
                children: [
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          if (inProgress) _buildTimer(),
                          if (!inProgress || _countdownStep != null)
                            Expanded(child: Center(child: _buildLoader()))
                          else ...[
                            _hasTabs
                                ? Flexible(child: _buildParticipants())
                                : Expanded(child: _buildParticipants()),
                            if (_hasTabs)
                              Expanded(
                                child: SessionInfoTabs(
                                  scenario: widget.scenario!,
                                  triggeredEventIds: _detectedEventIds,
                                ),
                              ),
                          ],
                          if (inProgress && (widget.scenario?.showScoreMeter ?? true))
                            FractionallySizedBox(
                              widthFactor: 0.8,
                              child: Padding(
                                padding: const EdgeInsets.only(top: 10, bottom: 20),
                                child: SessionScoreMeter(score: _score),
                              ),
                            ),
                          if (_error != null)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 8),
                              child: Text(
                                _error!,
                                textAlign: TextAlign.center,
                                style: const TextStyle(color: AppColors.red400),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                  if (inProgress)
                    _SimulationControls(
                      isMaximized: _controlsMaximized,
                      onToggleMaximized: () => setState(() => _controlsMaximized = !_controlsMaximized),
                      buttons: [
                        _ControlButton(
                          id: 'mic',
                          icon: SvgPicture.asset(_isMicEnabled ? 'assets/icons/micOn.svg' : 'assets/icons/micOff.svg'),
                          label: ref.t(_isMicEnabled ? 'simulationPage.mute' : 'simulationPage.unmute'),
                          onPressed: _toggleMic,
                          // Pause is a superset of mute.
                          disabled: _isPaused,
                          variant: _isMicEnabled ? _ControlVariant.normal : _ControlVariant.active,
                        ),
                        if (_showFocusButton)
                          _ControlButton(
                            id: 'focus',
                            icon: SvgPicture.asset(
                              'assets/icons/mic.svg',
                              colorFilter: ColorFilter.mode(
                                _isFocusMode ? Colors.black : Colors.white,
                                BlendMode.srcIn,
                              ),
                            ),
                            label: ref.t(_isFocusMode ? 'listeningScreen.focused' : 'listeningScreen.focus'),
                            onPressed: () => setState(() => _isFocusMode = !_isFocusMode),
                            disabled: _isPaused,
                            variant: _isFocusMode ? _ControlVariant.active : _ControlVariant.normal,
                          ),
                        if (_showPauseButton)
                          _ControlButton(
                            id: 'pause',
                            key: const ValueKey('pause-resume-button'),
                            icon: SvgPicture.asset(
                              _isPaused ? 'assets/icons/playWhite.svg' : 'assets/icons/pauseWhite.svg',
                            ),
                            label: ref.t(_isPaused ? 'simulationPage.resume' : 'simulationPage.pause'),
                            onPressed: _togglePause,
                            variant: _isPaused ? _ControlVariant.active : _ControlVariant.normal,
                          ),
                        _ControlButton(
                          id: 'end',
                          icon: Container(
                            width: RnSize.of(context).s(16),
                            height: RnSize.of(context).s(16),
                            decoration: BoxDecoration(
                              color: AppColors.coralRed,
                              borderRadius: BorderRadius.circular(2),
                            ),
                          ),
                          label: widget.scenarioSessionId == null
                              ? ref.t('roleplayVoice.disconnect')
                              : ref.t('simulationPage.endSession'),
                          onPressed: _isEnding ? null : _endCall,
                          variant: _ControlVariant.destructive,
                        ),
                      ],
                    ),
                ],
              ),
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

  /// RN `SimulationTimer`: "Session Duration: " + the mm:ss value in
  /// Medium 16, centred, 8 above and below. Only this text listens to the
  /// per-second [_elapsed] notifier, so the screen doesn't rebuild.
  Widget _buildTimer() {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: RnSize.of(context).vs(8)),
      child: ValueListenableBuilder<Duration>(
        valueListenable: _elapsed,
        builder: (context, elapsed, _) => Text.rich(
          TextSpan(
            // RN appends ': ' to a key that already ends in ':' ("Session
            // Duration::") — matched without the doubled colon.
            text: '${ref.t('simulationPage.sessionDuration')} ',
            style: const TextStyle(fontFamily: AppFonts.ibmPlexSerifRegular, fontSize: 14, color: Colors.white),
            children: [
              TextSpan(
                text: _formatDuration(elapsed),
                style: const TextStyle(fontFamily: AppFonts.ibmPlexSerifMedium, fontSize: 16),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// RN `renderLoader`: the connection status in Replay Pro bold italic,
  /// white, centred. This port connects on demand rather than on mount, so
  /// before connecting it also offers the Connect action.
  Widget _buildLoader() {
    final status = _isConnected
        ? ref.t('simulationPage.waitingForAgent')
        : ref.t('simulationPage.connectingToSession');
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 40),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            status,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontFamily: AppFonts.replayProBoldItalic,
              fontStyle: FontStyle.italic,
              fontSize: 16,
              color: Colors.white,
            ),
          ),
          if (!_isConnected) ...[
            const SizedBox(height: 24),
            AppButton(label: ref.t('roleplayVoice.connect'), onPressed: _connect),
          ],
        ],
      ),
    );
  }

  /// RN `renderParticipants`: the AI client's tile (280pt tall, 180 with
  /// the info tabs below, full height otherwise) with the learner's own
  /// 84x116 picture-in-picture bubble inlaid bottom-right, the scenario
  /// (i) overlay top-left, and the live coaching nudge underneath.
  Widget _buildParticipants() {
    final scenario = widget.scenario;
    final title = scenario?.title ?? '';
    final tile = Stack(
      clipBehavior: Clip.none,
      children: [
        Positioned.fill(
          child: ParticipantTile(
            key: const ValueKey('participant-tile-remote'),
            avatarUrl: scenario?.coverImageUrl,
            name: title,
            isSpeaking: _remoteSpeaking,
            turnState: _turnStates.remote,
          ),
        ),
        Positioned(
          right: 10,
          bottom: 10,
          width: 84,
          height: 116,
          child: Container(
            key: const ValueKey('participant-pip'),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.callDivider, width: 2),
              boxShadow: const [BoxShadow(color: Color(0x59000000), offset: Offset(0, 2), blurRadius: 6)],
            ),
            clipBehavior: Clip.antiAlias,
            child: ParticipantTile(
              key: const ValueKey('participant-tile-local'),
              avatarUrl: null,
              isSpeaking: _localSpeaking,
              turnState: _turnStates.local,
              isMuted: !_isMicEnabled,
              compact: true,
            ),
          ),
        ),
        if (title.isNotEmpty) ...[
          Positioned(
            top: 12,
            left: 12,
            child: GestureDetector(
              key: const ValueKey('scenario-info-toggle'),
              onTap: () => setState(() => _showScenarioInfo = !_showScenarioInfo),
              child: SvgPicture.asset('assets/icons/infoBlackCircle.svg'),
            ),
          ),
          if (_showScenarioInfo)
            Positioned(
              top: 12,
              left: 36,
              right: 35,
              child: Align(alignment: Alignment.topLeft, child: _ScenarioInfoPanel(scenario: scenario!)),
            ),
        ],
      ],
    );

    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 16),
      child: Column(
        mainAxisSize: _hasTabs ? MainAxisSize.min : MainAxisSize.max,
        children: [
          // RN `participantsCompact`: 180 tall, but shrinks with the rest
          // (flexShrink) when the expanded controls need the room.
          if (_hasTabs)
            Flexible(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 180),
                child: SizedBox.expand(child: tile),
              ),
            )
          else
            Expanded(child: tile),
          if (!(scenario?.hasChecklist ?? false) && !_isFocusMode && _feedbackMessage != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 14),
              child: LiveFeedbackToast(
                key: ValueKey(_feedbackKey),
                message: _feedbackMessage!,
                emoji: _feedbackEmoji,
              ),
            ),
        ],
      ),
    );
  }
}

enum _ControlVariant { normal, active, destructive }

class _ControlButton {
  const _ControlButton({
    required this.id,
    required this.icon,
    required this.label,
    required this.onPressed,
    this.disabled = false,
    this.variant = _ControlVariant.normal,
    this.key,
  });

  final String id;
  final Widget icon;
  final String label;
  final VoidCallback? onPressed;
  final bool disabled;
  final _ControlVariant variant;
  final Key? key;
}

/// Port of RN `SimulationControls` → `components/ButtonGroup`'s
/// `CollapsibleButtonGroup` + `ButtonItem`: a translucent bottom bar with
/// a chevron that expands/collapses a full-width stack of 8pt-radius
/// `#282B31` buttons (white when active, icon + IBM Plex Serif Medium 14
/// label), collapsed by default.
class _SimulationControls extends StatelessWidget {
  const _SimulationControls({required this.isMaximized, required this.onToggleMaximized, required this.buttons});

  final bool isMaximized;
  final VoidCallback onToggleMaximized;
  final List<_ControlButton> buttons;

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    return Container(
      key: const ValueKey('simulation-control-buttons'),
      width: double.infinity,
      color: AppColors.blackAlpha200,
      padding: EdgeInsets.only(top: rn.mvs(8), bottom: rn.mvs(6), left: 16, right: 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          GestureDetector(
            key: const ValueKey('simulation-control-buttons-toggle'),
            behavior: HitTestBehavior.opaque,
            onTap: onToggleMaximized,
            child: Container(
              width: 48,
              height: rn.mvs(32),
              margin: EdgeInsets.only(bottom: rn.mvs(12)),
              alignment: Alignment.center,
              child: AnimatedRotation(
                turns: isMaximized ? 0 : 0.5,
                duration: const Duration(milliseconds: 250),
                child: SvgPicture.asset(
                  'assets/icons/chevronDown.svg',
                  width: 24,
                  height: 12,
                  colorFilter: const ColorFilter.mode(AppColors.lightGrayD9, BlendMode.srcIn),
                ),
              ),
            ),
          ),
          if (isMaximized)
            for (var i = 0; i < buttons.length; i++) ...[
              if (i > 0) SizedBox(height: rn.s(8)),
              _buildButton(context, buttons[i], isLast: i == buttons.length - 1),
            ],
        ],
      ),
    );
  }

  Widget _buildButton(BuildContext context, _ControlButton button, {required bool isLast}) {
    final rn = RnSize.of(context);
    final background = switch (button.variant) {
      _ControlVariant.active => Colors.white,
      _ => AppColors.darkGray10,
    };
    final textColor = button.variant == _ControlVariant.active ? AppColors.darkGray5 : Colors.white;
    final enabled = !button.disabled && button.onPressed != null;
    return Padding(
      key: button.key,
      padding: EdgeInsets.only(bottom: isLast ? rn.mvs(8) : 0),
      child: Opacity(
        opacity: button.disabled ? 0.5 : 1,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: enabled ? button.onPressed : null,
          child: Container(
            width: double.infinity,
            padding: EdgeInsets.symmetric(vertical: rn.vs(16)),
            decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(8)),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                button.icon,
                SizedBox(width: rn.s(10)),
                Text(
                  button.label,
                  style: TextStyle(fontFamily: AppFonts.ibmPlexSerifMedium, fontSize: 14, color: textColor),
                ),
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

/// Port of RN's `ScenarioInfoOverlay` panel: title (3 lines max) and the
/// trigger warnings joined with bullets, on 87% black, opened by the (i)
/// icon in the AI tile's top-left corner.
class _ScenarioInfoPanel extends ConsumerWidget {
  const _ScenarioInfoPanel({required this.scenario});

  final Scenario scenario;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Container(
      constraints: const BoxConstraints(minWidth: 200, maxWidth: 400),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.87),
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
            style: const TextStyle(fontFamily: AppFonts.ibmPlexSerifMedium, color: Colors.white),
          ),
          if (scenario.triggerWarnings.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                scenario.triggerWarnings.join(' • '),
                style: const TextStyle(
                  fontFamily: AppFonts.ibmPlexSerifRegular,
                  fontSize: 12,
                  height: 16 / 12,
                  letterSpacing: 0.2,
                  color: Color(0xB3FFFFFF),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
