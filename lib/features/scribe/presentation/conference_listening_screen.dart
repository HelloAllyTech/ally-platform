import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/config/app_config.dart';
import '../../../core/localization/translate_ref.dart';
import '../../../core/permissions/permissions_repository.dart';
import '../../../core/permissions/user_permissions.dart';
import '../../../core/realtime/socket_events.dart';
import '../../../core/realtime/socket_service.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../data/chat_models.dart';
import '../data/chat_repository.dart';
import 'audio_waveform.dart';
import 'dismissable_banner.dart';
import 'elapsed_timer.dart';
import 'listening_controls.dart';
import 'nudge_section.dart';

/// Real port of ally-mobile (React Native)'s `ConferenceListeningScreen` —
/// the companion screen for a cloud-telephony (Exotel/Ozonetel) conference
/// call. Confirmed by reading the real RN screen and its backend: this is
/// **not** a telephony SDK integration. The actual phone call happens
/// entirely over the carrier network, between the client and the
/// counsellor's real registered phone number; the backend only relays
/// lifecycle events (`USER_JOINED`, `NUDGE`, `AUDIO_STREAM`, `CHAT_ENDED`)
/// over Socket.IO once the call connects. So this screen needs no vendor
/// SDK — it's the same `SocketService` Scribe's recording screen uses,
/// pointed at [AppConfig.cloudTelephonyPath] instead of
/// [AppConfig.microphoneSocketPath].
///
/// Reuses the same real, tested shared pieces built for Scribe's recording
/// screen (`ElapsedTimer`, `AudioWaveformContainer`, `NudgeSection`,
/// `ListeningControls`) — confirmed from source that RN's own
/// `ConferenceListeningScreen` shares those exact same components with
/// `MicrophoneListeningScreen`, not conference-specific equivalents. Real
/// differences from Scribe, all confirmed from source rather than assumed:
/// - The waveform is fed by the server's `AUDIO_STREAM` event, through
///   [exotelBytesToAmplitudes] — a genuinely different, simpler function
///   from Scribe's local-PCM [pcmBytesToAmplitudes] (raw unsigned-byte
///   averaging, no WAV/PCM16 decode, no rescale/gain/floor). Note: per
///   earlier research, the current backend doesn't appear to ever actually
///   emit a live `AUDIO_STREAM` for a real conference call — ported for
///   parity/completeness, not validated against a live payload.
/// - No transcript UI at all (RN's own screen has none).
/// - [DismissableBanner] shown only in focus mode — conference-only, no
///   Scribe equivalent.
/// - No [NetworkDisconnected] state machine — RN's own conference screen
///   has none either, just the plain "Connecting…" spinner until a chat id
///   arrives (no 5s timeout, no offline listener).
/// - `ListeningControls`'s pause/resume and end-session buttons are BOTH
///   hidden (`showPauseResumeButton`/`showEndSessionButton: false`),
///   confirmed to match RN's own real configuration exactly — a conference
///   call cannot be paused or ended from this screen in RN either; it ends
///   only when the carrier call itself ends and the backend pushes
///   `CHAT_ENDED`. Deliberately not "improved on" here.
///
/// Not ported: RN's active-chat auto-discovery
/// (`useCounselorChat`/`useNavigationAwareCounselorChat` — polling
/// `GET /chats/counsellor-chat` on app foreground and force-navigating
/// here). Confirmed this is genuinely cross-cutting app infrastructure (a
/// `WidgetsBindingObserver`-style mechanism wired once at the navigation
/// root in RN, not anything screen-specific) that also covers Scribe's own
/// backgrounded/killed-session recovery — scoped as its own separate pass
/// rather than bundled into this screen's UI work. For now this screen is
/// reached with an already-known [chatId] rather than discovered on its own.
class ConferenceListeningScreen extends ConsumerStatefulWidget {
  const ConferenceListeningScreen({super.key, required this.chatId, required this.userId});

  /// Not read by this screen's own logic today — `endCall`/pause are both
  /// unreachable (see the class doc), and chat identity otherwise comes
  /// from whatever `getCounsellorChat()` currently returns, not this id.
  /// Kept as the route parameter it already is, for the active-chat
  /// auto-discovery pass and any future need to confirm the discovered
  /// chat matches what was expected.
  final int chatId;
  final String userId;

  @override
  ConsumerState<ConferenceListeningScreen> createState() => _ConferenceListeningScreenState();
}

class _ConferenceListeningScreenState extends ConsumerState<ConferenceListeningScreen> {
  // Resolved once up front rather than via `ref.read(...)` inside
  // `dispose()` — same fix, for the same reason, as
  // `scribe_recording_screen.dart`'s `_socketService`.
  late final SocketService _socketService;

  DateTime? _startedAt;
  bool _isFocusMode = true;
  bool _isBannerDismissed = false;

  Nudge? _currentNudge;
  bool _isNudgeLoading = false;

  final ValueNotifier<List<double>> _amplitudes = ValueNotifier(const []);
  int? _numBars;

  String? _error;

  @override
  void initState() {
    super.initState();
    _socketService = ref.read(socketServiceProvider);
    _connect();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Minus 32: the content renders inside this screen's own
    // `SingleChildScrollView(padding: EdgeInsets.all(16))` (16px each
    // side) — same overflow class this session already found and fixed on
    // Scribe's own waveform sizing.
    _numBars ??= numWaveformBars(MediaQuery.sizeOf(context).width - 32);
  }

  @override
  void dispose() {
    _socketService.disconnect();
    _amplitudes.dispose();
    super.dispose();
  }

  Future<void> _connect() async {
    await _socketService.connect(
      namespacePath: AppConfig.cloudTelephonyPath,
      userId: widget.userId,
      onConnect: () {},
      onDisconnect: (reason) {},
      eventCallbacks: {
        SocketEvent.userJoined: (_) => _onUserJoined(),
        SocketEvent.audioStream: _onAudioStream,
        SocketEvent.nudge: _onNudge,
        SocketEvent.chatEnded: (_) => _onCallEnded(),
      },
    );
  }

  Future<void> _onUserJoined() async {
    final chat = await ref.read(chatRepositoryProvider).getCounsellorChat();
    if (!mounted || chat == null) return;
    setState(() => _startedAt = DateTime.tryParse(chat.startedAt) ?? DateTime.now());
  }

  void _onAudioStream(dynamic data) {
    final payload = data is Map ? data['payload'] ?? data : null;
    final audioData = payload is Map ? payload['audioData'] : null;
    final numBars = _numBars;
    if (audioData is! String || numBars == null) return;
    try {
      _amplitudes.value = exotelBytesToAmplitudes(base64Decode(audioData), numBars: numBars);
    } catch (_) {
      // A malformed/undecodable chunk is skipped rather than crashing this
      // listener — the next chunk just redraws the waveform as usual.
    }
  }

  void _onNudge(dynamic data) {
    final payload = data is Map ? data['payload'] ?? data : null;
    if (payload is! Map) return;
    setState(() => _isNudgeLoading = true);
    Future<void>.delayed(const Duration(milliseconds: 500), () {
      if (!mounted) return;
      setState(() {
        _currentNudge = Nudge.fromJson(Map<String, dynamic>.from(payload));
        _isNudgeLoading = false;
      });
    });
  }

  void _onCallEnded() {
    if (!mounted) return;
    setState(() => _error = ref.tr('conferenceListening.callEnded'));
    _socketService.disconnect();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          TabScreenHeader(title: ref.t('conferenceListening.title')),
          Expanded(child: _buildBody()),
        ],
      ),
    );
  }

  Widget _buildBody() {
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            _error!,
            style: const TextStyle(color: AppColors.red400),
            textAlign: TextAlign.center,
          ),
        ),
      );
    }

    if (_startedAt == null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const CircularProgressIndicator(),
            const SizedBox(height: 16),
            Text(ref.t('conferenceListening.waitingForClient')),
          ],
        ),
      );
    }

    final canToggleFocusMode =
        ref.watch(userPermissionsProvider).value?.contains(UserPermissions.viewReferenceDocument) ??
        false;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          if (_isFocusMode && !_isBannerDismissed)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: DismissableBanner(onClose: () => setState(() => _isBannerDismissed = true)),
            ),
          Text(ref.t('listeningScreen.takingNotes')),
          const SizedBox(height: 8),
          ElapsedTimer(startTime: _startedAt!),
          const SizedBox(height: 16),
          AudioWaveformContainer(
            amplitudes: _amplitudes,
            isPaused: false,
            isFocusMode: _isFocusMode,
          ),
          if (!_isFocusMode && (_currentNudge != null || _isNudgeLoading)) ...[
            const SizedBox(height: 16),
            NudgeSection(nudge: _currentNudge, isLoading: _isNudgeLoading),
          ],
          const SizedBox(height: 24),
          ListeningControls(
            isCallPaused: false,
            onPauseResumePress: () {},
            onCallEndPress: () {},
            showPauseResumeButton: false,
            showEndSessionButton: false,
            showFocusModeButton: canToggleFocusMode,
            isFocusMode: _isFocusMode,
            onFocusModeButtonPress: () => setState(() => _isFocusMode = !_isFocusMode),
          ),
        ],
      ),
    );
  }
}
