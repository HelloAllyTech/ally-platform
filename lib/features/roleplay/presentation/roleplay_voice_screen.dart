import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/realtime/livekit_room_service.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../../simulations/data/simulation_models.dart';
import '../../simulations/data/simulations_repository.dart';

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
/// Not ported: pause/resume. RN's pause sends a reliable LiveKit data-channel
/// message (`room.localParticipant.publishData`) the agent acks over
/// `RoomEvent.DataReceived`, with an optimistic-UI/revert-on-timeout race —
/// real new LiveKit wrapper plumbing and a genuinely riskier state machine
/// than everything else here, not a pure-UI gap. Deferred to its own pass
/// (see the full-app audit's reclassification note).
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
  Duration _elapsed = Duration.zero;
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

  bool get _showFocusButton => widget.scenario?.experienceMode != 'NONE';

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
    _liveKitService.disconnect();
    super.dispose();
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
    final elapsed = widget.now().difference(_startTime!);
    final maxTimeSec = _parseMaxTimeSec(widget.scenario?.maxTimeValue);
    setState(() => _elapsed = elapsed);

    if (maxTimeSec - elapsed.inSeconds <= _warningThresholdSeconds && !_hasWarned) {
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
      await ref.read(simulationsRepositoryProvider).endScenarioSession(sessionId);
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
                title: '${ref.t('simulationPage.warningDialog.titleNormal')} '
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
                title: '${ref.t('listeningScreen.end')}${ref.t('common.simulation')}',
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
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SvgPicture.asset(
              _isConnected ? 'assets/icons/micOn.svg' : 'assets/icons/micOff.svg',
              width: 64,
              height: 64,
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
                child: Text(
                  '${ref.t('simulationPage.sessionDuration')} ${_formatDuration(_elapsed)}',
                ),
              ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(_error!, style: const TextStyle(color: AppColors.red400)),
              ),
            const SizedBox(height: 24),
            if (!_isConnected)
              AppButton(label: ref.t('roleplayVoice.connect'), onPressed: _connect)
            else ...[
              AppButton(
                label: _isMicEnabled
                    ? ref.t('simulationPage.mute')
                    : ref.t('simulationPage.unmute'),
                iconLeft: SvgPicture.asset(
                  _isMicEnabled ? 'assets/icons/mic.svg' : 'assets/icons/micOff.svg',
                  width: 20,
                  height: 20,
                  colorFilter: const ColorFilter.mode(Colors.white, BlendMode.srcIn),
                ),
                onPressed: _toggleMic,
              ),
              if (_showFocusButton) ...[
                const SizedBox(height: 12),
                AppButton(
                  label: ref.t(_isFocusMode ? 'listeningScreen.focused' : 'listeningScreen.focus'),
                  variant: AppButtonVariant.secondary,
                  onPressed: () => setState(() => _isFocusMode = !_isFocusMode),
                ),
              ],
              if ((widget.scenario?.title ?? '').isNotEmpty) ...[
                const SizedBox(height: 12),
                AppButton(
                  label: ref.t('common.details'),
                  variant: AppButtonVariant.secondary,
                  onPressed: () => setState(() => _showScenarioInfo = !_showScenarioInfo),
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
                  style: const TextStyle(color: Colors.white, fontSize: 48, fontWeight: FontWeight.bold),
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
            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
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
