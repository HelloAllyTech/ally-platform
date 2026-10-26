import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/config/app_config.dart';
import '../../../core/localization/translate_ref.dart';
import '../../../core/realtime/socket_events.dart';
import '../../../core/realtime/socket_service.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../data/chat_repository.dart';

/// Phase 1 proof of ally-mobile (React Native)'s `ConferenceListeningScreen`
/// — the companion screen for a cloud-telephony (Exotel/Ozonetel) conference
/// call. Confirmed by reading the real RN screen and its backend: this is
/// **not** a telephony SDK integration. The actual phone call happens
/// entirely over the carrier network, between the client and the
/// counsellor's real registered phone number; the backend only relays
/// lifecycle events (`USER_JOINED`, `NUDGE`, `AUDIO_STREAM`, `CHAT_ENDED`)
/// over Socket.IO once the call connects. So this screen needs no new
/// vendor SDK — it's the same `SocketService` Scribe's `ScribeRecordingScreen`
/// already uses, pointed at [AppConfig.cloudTelephonyPath] instead of
/// [AppConfig.microphoneSocketPath].
///
/// Unlike Scribe's screen, there is no explicit "join" action: RN's screen
/// auto-connects the moment it's navigated to (the call itself already
/// started by the time this screen could exist), so this one connects in
/// `initState` rather than behind a button.
///
/// Deliberately NOT a port of the full UI (waveform, timer, nudge banners,
/// focus mode, reference-document search) — matching `scribe_recording_screen.dart`'s
/// own scope, since neither Scribe's nor this screen's real UI exists in
/// Flutter yet. Also NOT ported: RN's active-chat auto-discovery
/// (`useCounselorChat`/`useNavigationAwareCounselorChat` — polling
/// `GET /chats/counsellor-chat` on app foreground and force-navigating here
/// whenever an active conference chat exists). That's a real, separate,
/// cross-cutting pass (it also covers Scribe's own backgrounded/killed
/// session recovery), so for now this screen is reached with an already-known
/// [chatId] rather than discovered on its own.
class ConferenceListeningScreen extends ConsumerStatefulWidget {
  const ConferenceListeningScreen({super.key, required this.chatId, required this.userId});

  final int chatId;
  final String userId;

  @override
  ConsumerState<ConferenceListeningScreen> createState() => _ConferenceListeningScreenState();
}

class _ConferenceListeningScreenState extends ConsumerState<ConferenceListeningScreen> {
  bool _isSocketConnected = false;
  bool _clientJoined = false;
  bool _isPaused = false;
  bool _isEnding = false;
  int _audioChunksReceived = 0;
  int _nudgesReceived = 0;
  String? _error;

  // Resolved once up front rather than via `ref.read(...)` inside
  // `dispose()` — same fix, for the same reason, as
  // `roleplay_voice_screen.dart`'s `_liveKitService`: reading a provider in
  // `dispose()` is unsafe once the widget is mid-unmount, reproduced here by
  // this screen's own widget test.
  late final SocketService _socketService;

  @override
  void initState() {
    super.initState();
    _socketService = ref.read(socketServiceProvider);
    _connect();
  }

  @override
  void dispose() {
    _socketService.disconnect();
    super.dispose();
  }

  Future<void> _connect() async {
    await _socketService.connect(
      namespacePath: AppConfig.cloudTelephonyPath,
      userId: widget.userId,
      onConnect: () {
        if (mounted) setState(() => _isSocketConnected = true);
      },
      onDisconnect: (reason) {
        if (mounted) setState(() => _isSocketConnected = false);
      },
      eventCallbacks: {
        SocketEvent.userJoined: (_) {
          if (mounted) setState(() => _clientJoined = true);
        },
        SocketEvent.audioStream: (_) {
          if (mounted) setState(() => _audioChunksReceived++);
        },
        SocketEvent.nudge: (_) {
          if (mounted) setState(() => _nudgesReceived++);
        },
        SocketEvent.chatEnded: (_) => _onCallEnded(),
      },
    );
  }

  void _onCallEnded() {
    if (!mounted) return;
    setState(() {
      _error = ref.tr('conferenceListening.callEnded');
    });
    _socketService.disconnect();
  }

  /// Mirrors RN's debounced play/pause handler: pauses AI nudges, not any
  /// audio (this screen has no audio playback of its own).
  void _togglePause() {
    final next = !_isPaused;
    _socketService.emit(next ? SocketEvent.audioChatPaused : SocketEvent.audioChatResumed, {});
    setState(() => _isPaused = next);
  }

  Future<void> _endSession() async {
    setState(() => _isEnding = true);
    try {
      await ref.read(chatRepositoryProvider).endCall(widget.chatId);
      _socketService.disconnect();
      if (mounted) Navigator.of(context).pop();
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
          TabScreenHeader(title: ref.t('conferenceListening.title')),
          Expanded(
            child: Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      _clientJoined
                          ? ref.t('conferenceListening.clientJoined')
                          : ref.t('conferenceListening.waitingForClient'),
                    ),
                    Text(
                      '${ref.t('conferenceListening.socketLabel')}: ${_isSocketConnected ? ref.t('conferenceListening.connected') : ref.t('conferenceListening.disconnected')}',
                    ),
                    Text(ref.t('conferenceListening.audioChunksReceived', {'count': _audioChunksReceived})),
                    Text(ref.t('conferenceListening.nudgesReceived', {'count': _nudgesReceived})),
                    if (_error != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(_error!, style: const TextStyle(color: AppColors.red400)),
                      ),
                    const SizedBox(height: 24),
                    AppButton(
                      label: ref.t(
                        _isPaused ? 'conferenceListening.resume' : 'conferenceListening.pause',
                      ),
                      variant: AppButtonVariant.secondary,
                      onPressed: _togglePause,
                    ),
                    const SizedBox(height: 12),
                    AppButton(
                      label: ref.t('conferenceListening.endSession'),
                      variant: AppButtonVariant.destructive,
                      isLoading: _isEnding,
                      onPressed: _endSession,
                    ),
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
