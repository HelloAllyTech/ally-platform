import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/chat/current_chat_provider.dart';
import '../../../core/config/app_config.dart';
import '../../../core/permissions/permissions_repository.dart';
import '../../../core/permissions/user_permissions.dart';
import '../../../core/realtime/keep_awake.dart';
import '../../../core/realtime/socket_events.dart';
import '../../../core/realtime/socket_service.dart';
import '../../../core/settings/settings_repository.dart';
import '../../../core/theme/rn_scale.dart';
import '../data/chat_models.dart';
import '../data/chat_repository.dart';
import 'audio_waveform.dart';
import 'dismissable_banner.dart';
import 'elapsed_timer.dart';
import 'listening_chrome.dart';
import 'listening_controls.dart';
import 'nudge_section.dart';

/// Port of ally-mobile (React Native)'s `ConferenceListeningScreen` — the
/// companion screen for a cloud-telephony (Exotel/Ozonetel) conference
/// call. The call itself runs over the carrier network; the backend relays
/// `USER_JOINED`, `NUDGE`, `AUDIO_STREAM` and `CHAT_ENDED` over Socket.IO on
/// [AppConfig.cloudTelephonyPath], so no telephony SDK is involved.
///
/// Same dark page as Scribe's screen (`listening_chrome.dart`): focus mode
/// shows the "Scribe stops taking notes" banner (conference providers only,
/// dismissable), the lock + "Taking notes" row with its privacy tooltip, the
/// timer and the large waveform; non-focus mode the compact row and the
/// nudge. No transcript. Pause/resume and End session are hidden, as in RN:
/// the call ends when the carrier call ends and the server sends
/// `CHAT_ENDED`, which — like the microphone screen — replaces this screen
/// with box breathing.
///
/// The waveform is fed by `AUDIO_STREAM` ([exotelBytesToAmplitudes]) and
/// fades back to rest when no audio has arrived for 2 s (RN
/// `AUDIO_INACTIVE_TIMEOUT`). The socket is dropped in the background and
/// reconnected in the foreground (RN `useSocketConnection` default), and on
/// returning the chat is re-checked: if it ended meanwhile, box breathing.
/// The screen is kept awake throughout.
///
/// Not ported: the reference-document `Search` panel in non-focus mode.
class ConferenceListeningScreen extends ConsumerStatefulWidget {
  const ConferenceListeningScreen({super.key, required this.chatId, required this.userId});

  /// The chat active-chat discovery routed here for; used as the current
  /// chat until `USER_JOINED` hydrates it.
  final int chatId;
  final String userId;

  @override
  ConsumerState<ConferenceListeningScreen> createState() => _ConferenceListeningScreenState();
}

class _ConferenceListeningScreenState extends ConsumerState<ConferenceListeningScreen> with WidgetsBindingObserver {
  static const _audioInactiveTimeout = Duration(seconds: 2);

  late final SocketService _socketService;
  late final KeepAwake _keepAwake;

  /// RN `chatData` (`state.chat.currentChat`).
  Chat? _chat;
  final DateTime _mountedAt = DateTime.now();

  bool _isFocusMode = true;
  bool _isBannerDismissed = false;
  bool _hasLeft = false;

  Nudge? _currentNudge;
  bool _isNudgeLoading = false;

  final ValueNotifier<List<double>> _amplitudes = ValueNotifier(const []);
  int? _numBars;
  Timer? _audioInactiveTimer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _socketService = ref.read(socketServiceProvider);
    _keepAwake = ref.read(keepAwakeProvider);
    _keepAwake.activate();
    final current = ref.read(currentChatProvider);
    if (current != null) _chat = current;
    _connect();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _numBars ??= numWaveformBars(MediaQuery.sizeOf(context).width);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _keepAwake.deactivate();
    _audioInactiveTimer?.cancel();
    _socketService.disconnect();
    _amplitudes.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (!mounted) return;
    if (state == AppLifecycleState.resumed) {
      _connect();
      Timer(const Duration(milliseconds: 500), _checkChatStillActive);
    } else if (state == AppLifecycleState.paused) {
      _socketService.disconnect();
    }
  }

  Future<void> _connect() {
    return _socketService.connect(
      namespacePath: AppConfig.cloudTelephonyPath,
      userId: widget.userId,
      onConnect: () {},
      onDisconnect: (reason) {},
      eventCallbacks: {
        SocketEvent.userJoined: (_) => _onUserJoined(),
        SocketEvent.audioStream: _onAudioStream,
        SocketEvent.nudge: _onNudge,
        SocketEvent.chatEnded: (_) => _goToBreathing(),
      },
    );
  }

  /// RN `checkCounselorChat()`.
  Future<void> _onUserJoined() async {
    Chat? chat;
    try {
      chat = await ref.read(chatRepositoryProvider).getCounsellorChat();
    } catch (_) {
      return;
    }
    if (!mounted || chat == null) return;
    ref.read(currentChatProvider.notifier).set(chat);
    setState(() => _chat = chat);
  }

  Future<void> _checkChatStillActive() async {
    if (!mounted || _hasLeft) return;
    Chat? chat;
    try {
      chat = await ref.read(chatRepositoryProvider).getCounsellorChat();
    } catch (_) {
      return;
    }
    if (chat == null) _goToBreathing();
  }

  void _onAudioStream(dynamic data) {
    final payload = data is Map ? data['payload'] ?? data : null;
    final audioData = payload is Map ? payload['audioData'] : null;
    final numBars = _numBars;
    if (audioData is String && numBars != null && (_chat?.isConferenceCall ?? true)) {
      try {
        _amplitudes.value = exotelBytesToAmplitudes(base64Decode(audioData), numBars: numBars);
      } catch (_) {
        // A malformed chunk is skipped; the next one redraws.
      }
    }
    // RN: no audio for AUDIO_INACTIVE_TIMEOUT → clear (the bars fade out).
    _audioInactiveTimer?.cancel();
    _audioInactiveTimer = Timer(_audioInactiveTimeout, () {
      if (mounted) _amplitudes.value = const [];
    });
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

  /// RN `handleCallEndRedirection`: replace with Breathing.
  void _goToBreathing() {
    if (!mounted || _hasLeft) return;
    _hasLeft = true;
    final chatId = _chat?.chatId ?? widget.chatId;
    GoRouter.maybeOf(context)?.go('/box-breathing?chatId=$chatId');
  }

  DateTime get _startTime => DateTime.tryParse(_chat?.startedAt ?? '') ?? _mountedAt;

  @override
  Widget build(BuildContext context) {
    return ListeningPage(child: _buildBody());
  }

  Widget _buildBody() {
    if (_chat == null) return const ListeningConnectingView();

    final canToggleFocusMode =
        ref.watch(userPermissionsProvider).value?.contains(UserPermissions.viewReferenceDocument) ?? false;
    return Stack(
      children: [
        Positioned.fill(child: _isFocusMode ? _buildFocusMode() : _buildNonFocusMode()),
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: ListeningControls(
            isCallPaused: false,
            onPauseResumePress: () {},
            onCallEndPress: () {},
            showPauseResumeButton: false,
            showEndSessionButton: false,
            showFocusModeButton: canToggleFocusMode,
            isFocusMode: _isFocusMode,
            onFocusModeButtonPress: () => setState(() => _isFocusMode = !_isFocusMode),
          ),
        ),
      ],
    );
  }

  Widget _buildFocusMode() {
    final rn = RnSize.of(context);
    return Column(
      children: [
        if ((_chat?.isConferenceCall ?? false) && !_isBannerDismissed)
          DismissableBanner(onClose: () => setState(() => _isBannerDismissed = true)),
        Expanded(
          child: Padding(
            padding: EdgeInsets.only(bottom: rn.vs(100)),
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TakingNotesRow(isFocusMode: _isFocusMode),
                  ElapsedTimer(startTime: _startTime),
                  Padding(
                    padding: EdgeInsets.only(top: rn.vs(40)),
                    child: FractionallySizedBox(
                      widthFactor: 0.96,
                      child: AudioWaveformContainer(amplitudes: _amplitudes, isPaused: false, isFocusMode: true),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildNonFocusMode() {
    final rn = RnSize.of(context);
    final showNudge = (ref.watch(nudgeStatusProvider).value ?? false) && _currentNudge != null;
    return Padding(
      padding: EdgeInsets.only(top: rn.vs(40), left: rn.s(20), right: rn.s(20)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Padding(
                  padding: EdgeInsets.only(left: rn.s(10)),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      TakingNotesRow(isFocusMode: _isFocusMode),
                      ElapsedTimer(startTime: _startTime),
                    ],
                  ),
                ),
              ),
              Expanded(
                child: AudioWaveformContainer(amplitudes: _amplitudes, isPaused: false, isFocusMode: false),
              ),
            ],
          ),
          if (showNudge)
            NudgeSection(
              nudge: _currentNudge,
              isLoading: _isNudgeLoading,
              onFeedbackSuccess: (feedback) =>
                  setState(() => _currentNudge = _currentNudge?.copyWithFeedback(feedback)),
            ),
        ],
      ),
    );
  }
}
