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
import '../../simulations/data/simulations_repository.dart';

/// Phase 1's other half: live roleplay voice, mirroring ally-mobile (React
/// Native)'s `SimulationAssistantScreen.tsx` connection flow —
/// `room.connect(liveKitServerUrl, accessToken)`, both values owned by the
/// backend's session-creation response (unchanged by this rewrite).
///
/// [scenarioSessionId], when provided (set by SimulationDetailsScreen's real
/// "start simulation" flow), enables the "End session" action, which calls
/// the same `endScenarioSession` endpoint the RN screen uses and routes to
/// SimulationFeedbackScreen — closing the real scenario → session →
/// feedback loop end to end, not just proving the LiveKit connection in
/// isolation as Phase 1 originally scoped it.
///
/// Scoped to proving the connection + background-audio claim, not the full
/// SimulationAssistantScreen UI (live transcript, feedback nudges, AI
/// avatar) — that's substantial, separate work for a later phase.
class RoleplayVoiceScreen extends ConsumerStatefulWidget {
  const RoleplayVoiceScreen({
    super.key,
    required this.liveKitServerUrl,
    required this.accessToken,
    this.scenarioSessionId,
  });

  final String liveKitServerUrl;
  final String accessToken;
  final String? scenarioSessionId;

  @override
  ConsumerState<RoleplayVoiceScreen> createState() =>
      _RoleplayVoiceScreenState();
}

class _RoleplayVoiceScreenState extends ConsumerState<RoleplayVoiceScreen> {
  bool _isConnected = false;
  bool _isMicEnabled = false;
  bool _isEnding = false;
  String? _error;

  // Resolved once up front (not via `ref.read(...)` inside `dispose()`
  // itself) per Riverpod's own guidance: reading a provider in `dispose()`
  // is unsafe once the widget is mid-unmount, since `BuildContext`/`ref`
  // may already be invalid — reliably reproducible by unmounting this
  // screen in a widget test (see roleplay_voice_screen_dispose_test.dart),
  // which is exactly how this was found.
  late final LiveKitRoomService _liveKitService;

  @override
  void initState() {
    super.initState();
    _liveKitService = ref.read(liveKitRoomServiceProvider);
  }

  @override
  void dispose() {
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
    } catch (e) {
      setState(() => _error = '${ref.tr('errors.connect')}: $e');
    }
  }

  Future<void> _disconnect() async {
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          TabScreenHeader(title: ref.t('roleplayVoice.title')),
          Expanded(
            child: Center(
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
        ],
      ),
    );
  }
}
