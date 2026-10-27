import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:record/record.dart';

import '../../../core/config/app_config.dart';
import '../../../core/localization/translate_ref.dart';
import '../../../core/permissions/permissions_repository.dart';
import '../../../core/permissions/user_permissions.dart';
import '../../../core/realtime/foreground_recording_service.dart';
import '../../../core/realtime/socket_events.dart';
import '../../../core/realtime/socket_service.dart';
import '../../../core/settings/settings_repository.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/illustrated_modal.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../data/chat_models.dart';
import '../data/chat_repository.dart';
import '../data/transcript_logic.dart';
import 'audio_waveform.dart';
import 'call_transcript_item.dart';
import 'elapsed_timer.dart';
import 'listening_controls.dart';
import 'network_disconnected.dart';
import 'nudge_section.dart';

/// Real port of ally-mobile (React Native)'s `MicrophoneListeningScreen.tsx`
/// — Scribe's live recording screen: mic permission, the foreground service
/// (the actual Android 14+ reliability fix this whole migration exists
/// for), Socket.IO streaming, a real amplitude-driven waveform, the live
/// transcript, AI nudges with thumbs-up/down feedback, pause/resume (which
/// only gates audio emission, not the session clock or local recording),
/// and the three-way network-disconnected state machine.
///
/// Auto-starts in `initState` with no separate "Start recording" button —
/// matching RN exactly (there is no join action on this screen; by the
/// time a counsellor reaches it, `call_log_screen.dart`'s own consent/
/// mic-permission flow has already run) and matching this session's
/// `ConferenceListeningScreen`, which auto-connects the same way.
///
/// Not ported (scoped out, not silently missing):
/// - RN's `Search` resource-search widget in non-focus mode — a whole
///   separate feature (`SearchScreen`'s components), disproportionate to
///   pull into a recording screen's own scope.
/// - `CustomMarkdown` rendering of nudge content — plain text instead (see
///   `nudge_section.dart`).
/// - A real network-connectivity check distinguishing RN's `NETWORK` vs
///   `SOCKET` disconnected types — both map to [DisconnectedType.socket]
///   here; adding a connectivity-monitoring dependency just to pick between
///   two near-identical copy variants isn't proportionate on its own.
///   [DisconnectedType.microphoneFailure] (the 5s no-chatId timeout) is
///   wired for real, same as RN.
/// - `SocketService`'s AppState-driven reconnect-on-foreground/
///   disconnect-on-background lifecycle, and a cross-platform (iOS)
///   keep-awake — both are changes to shared infrastructure beyond this
///   screen, left for their own pass.
/// - The diagnostic telemetry block (`SCRIBE_START_DIAGNOSTIC`) — RN's own
///   comments call it a stopgap to delete once its root cause is known, not
///   real user-facing behavior.
class ScribeRecordingScreen extends ConsumerStatefulWidget {
  const ScribeRecordingScreen({super.key, required this.userId});

  final String userId;

  @override
  ConsumerState<ScribeRecordingScreen> createState() => _ScribeRecordingScreenState();
}

class _ScribeRecordingScreenState extends ConsumerState<ScribeRecordingScreen> {
  final AudioRecorder _recorder = AudioRecorder();

  // Resolved once up front rather than via `ref.read(...)` inside
  // `dispose()` — same fix, for the same reason, as
  // `roleplay_voice_screen.dart`'s `_liveKitService`.
  late final SocketService _socketService;

  bool _isMicrophoneModeSessionCreated = false;
  bool _isAudioChatEmitted = false;
  bool _isIntentionalDisconnect = false;

  int? _chatId;
  DateTime? _startedAt;

  // Mirrors RN's `isCallPaused` starting `true` — pausing only gates audio
  // emission, not the session clock (`ElapsedTimer` has no pause awareness)
  // or local recording.
  bool _isCallPaused = true;
  bool _isMuteTooltipOpen = false;

  List<Transcription> _myTranscriptions = [];
  List<Transcription> _speakerTranscriptions = [];

  Nudge? _currentNudge;
  bool _isNudgeLoading = false;

  DisconnectedType? _disconnectedType;
  Timer? _chatIdTimeoutTimer;

  // Mirrors RN's `useListeningCommon`'s own `useState(true)` default.
  bool _isFocusMode = true;

  final ValueNotifier<List<double>> _amplitudes = ValueNotifier(const []);
  int? _numBars;

  // Not resolved via `ref.tr()` into a stored string — this runs from
  // `initState`, before the localization controller's bundled-asset load
  // has necessarily finished, unlike the old Phase-1-proof screen's
  // permission check (gated behind a button tap the user could only reach
  // well after translations had loaded). Resolved live in `build()`
  // instead, via `ref.t()`, so it always reflects the current translation
  // state regardless of how early this fires.
  bool _permissionDenied = false;
  String? _error;
  bool _isEnding = false;
  bool _hasStartedRecording = false;

  @override
  void initState() {
    super.initState();
    _socketService = ref.read(socketServiceProvider);
    _start();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Minus 32: the waveform renders inside `_buildBody()`'s
    // `SingleChildScrollView(padding: EdgeInsets.all(16))` (16px each
    // side) — sizing bars from the full screen width instead of the
    // actual padded content width overflows by exactly that margin.
    _numBars ??= numWaveformBars(MediaQuery.sizeOf(context).width - 32);
  }

  @override
  void dispose() {
    _chatIdTimeoutTimer?.cancel();
    _isIntentionalDisconnect = true;
    if (_hasStartedRecording) _recorder.stop();
    _recorder.dispose();
    _socketService.disconnect();
    ForegroundRecordingService.stop();
    _amplitudes.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    final micStatus = await Permission.microphone.request();
    if (!micStatus.isGranted) {
      setState(() => _permissionDenied = true);
      return;
    }
    // Required on Android 13+ for the foreground service's own persistent
    // notification; without it the service can still start but the user
    // gets no visible indicator that recording is active.
    await Permission.notification.request();

    await _socketService.connect(
      namespacePath: AppConfig.microphoneSocketPath,
      userId: widget.userId,
      onConnect: () {},
      onDisconnect: (reason) {
        if (!mounted || _isIntentionalDisconnect) return;
        setState(() => _disconnectedType = DisconnectedType.socket);
      },
      onConnectionError: (error) {
        if (!mounted) return;
        setState(() => _disconnectedType = DisconnectedType.socket);
      },
      eventCallbacks: {
        SocketEvent.sessionCreated: (_) {
          if (!mounted) return;
          setState(() => _isMicrophoneModeSessionCreated = true);
          _maybeEmitStartAudioChat();
        },
        SocketEvent.userJoined: (_) => _onUserJoined(),
        SocketEvent.chatEnded: (_) => _onCallEndedByServer(),
        SocketEvent.nudge: (data) => _onNudge(data),
        SocketEvent.messageReceived: (data) => _onMessageReceived(data),
        SocketEvent.utteranceEnded: (data) => _onUtteranceEnded(data),
      },
    );

    _chatIdTimeoutTimer = Timer(const Duration(seconds: 5), () {
      if (mounted && _chatId == null) {
        setState(() => _disconnectedType = DisconnectedType.microphoneFailure);
      }
    });

    await ForegroundRecordingService.start(
      notificationTitle: ref.tr('scribe.notificationTitle'),
      notificationText: ref.tr('scribe.notificationText'),
    );

    // Matches MICROPHONE_AUDIO_SAMPLE_RATE / channels / bitsPerSample in
    // ally-mobile's src/constants/general.ts exactly — the backend's audio
    // pipeline expects this specific format.
    final stream = await _recorder.startStream(
      const RecordConfig(encoder: AudioEncoder.pcm16bits, sampleRate: 16000, numChannels: 1),
    );
    _hasStartedRecording = true;

    stream.listen(_onAudioChunk);
  }

  void _onAudioChunk(Uint8List chunk) {
    // Computed unconditionally on every chunk, independent of pause —
    // mirrors RN's `handleAudioData` exactly (`latestAmplitudesRef.current
    // = recorderAudioToAmplitudes(base64Wav)` runs before the pause check).
    _amplitudes.value = pcmBytesToAmplitudes(
      chunk,
      numBars: _numBars ?? numWaveformBars(360),
      platformGain: defaultTargetPlatform == TargetPlatform.iOS ? 3.0 : 1.0,
    );

    // Deliberately NOT gated on the socket's own connected state: socket.io buffers
    // frames during a transient disconnect and flushes them on reconnect —
    // gating here would silently drop audio during normal connection
    // blips, the exact bug RN's own comment warns against repeating.
    final chatId = _chatId;
    if (!_isCallPaused && chatId != null) {
      _socketService.emit(SocketEvent.audioMessage, {
        'audioData': base64Encode(chunk),
        'chatId': chatId,
      });
    }
  }

  void _maybeEmitStartAudioChat() {
    if (!_isMicrophoneModeSessionCreated || _isAudioChatEmitted) return;
    _isAudioChatEmitted = true;
    _socketService.emit(SocketEvent.startAudioChat, {
      'isLinear16Encoded': true,
      'platform': AllyPlatform.mobile,
      'sampleRate': 16000,
      'mode': 'SCRIBE',
    });
  }

  Future<void> _onUserJoined() async {
    final chat = await ref.read(chatRepositoryProvider).getCounsellorChat();
    if (!mounted || chat == null) return;
    _chatIdTimeoutTimer?.cancel();
    final rehydrated = rehydrateTranscriptions(chat.messages, int.tryParse(widget.userId) ?? -1);
    setState(() {
      _chatId = chat.chatId;
      _startedAt = DateTime.tryParse(chat.startedAt) ?? DateTime.now();
      _myTranscriptions = rehydrated.mine;
      _speakerTranscriptions = rehydrated.theirs;
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

  int? get _userIdAsInt => int.tryParse(widget.userId);

  void _onMessageReceived(dynamic data) {
    final payload = data is Map ? data['payload'] ?? data : null;
    if (payload is! Map || payload['type'] != MessageType.text) return;
    final transcription = Transcription.fromJson(Map<String, dynamic>.from(payload));
    setState(() {
      if (transcription.senderId == _userIdAsInt) {
        _myTranscriptions = processTranscription(_myTranscriptions, transcription);
      } else {
        _speakerTranscriptions = processTranscription(_speakerTranscriptions, transcription);
      }
    });
  }

  void _onUtteranceEnded(dynamic data) {
    final payload = data is Map ? data['payload'] ?? data : null;
    final senderId = payload is Map ? (payload['senderId'] as num?)?.toInt() : null;
    setState(() {
      if (senderId == _userIdAsInt) {
        _myTranscriptions = markLastTranscriptionComplete(_myTranscriptions);
      } else {
        _speakerTranscriptions = markLastTranscriptionComplete(_speakerTranscriptions);
      }
    });
  }

  void _onCallEndedByServer() {
    if (!mounted) return;
    _navigateToBreathingExercise();
  }

  void _togglePauseResume() {
    setState(() {
      _isCallPaused = !_isCallPaused;
      if (!_isCallPaused) _isMuteTooltipOpen = false;
    });
  }

  Future<void> _showEndConfirmation() async {
    await IllustratedModal.show(
      context,
      titleMain: ref.t('audioCall.endDialog.titleNormal'),
      titleItalic: ref.t('audioCall.endDialog.titleItalic'),
      description: ref.t('audioCall.endDialog.content'),
      actionButtonText: ref.t('audioCall.endDialog.endSession'),
      // `IllustratedModal`'s own action button already pops the dialog
      // itself after this runs — no second pop needed here (unlike
      // `app_drawer.dart`'s logout flow, which pops a *different* thing,
      // the drawer, not the dialog).
      onActionPressed: _endSession,
    );
  }

  Future<void> _endSession() async {
    setState(() => _isEnding = true);
    try {
      final chatId = _chatId;
      _isIntentionalDisconnect = true;
      if (_hasStartedRecording) await _recorder.stop();
      await ForegroundRecordingService.stop();
      if (chatId != null) {
        await ref.read(chatRepositoryProvider).endCall(chatId);
      }
      _socketService.disconnect();
      if (mounted) _navigateToBreathingExercise();
    } catch (e) {
      if (mounted) setState(() => _error = '${ref.tr('errors.endSimulation')}: $e');
    } finally {
      if (mounted) setState(() => _isEnding = false);
    }
  }

  void _navigateToBreathingExercise() {
    if (mounted) context.go('/box-breathing');
  }

  void _handleTryAgain() {
    setState(() => _disconnectedType = null);
    if (mounted) Navigator.of(context).pop();
  }

  bool get _hasLiveSession => _chatId != null && _disconnectedType == null;

  void _handleBackPress() {
    if (_hasLiveSession) {
      _showEndConfirmation();
    } else if (mounted) {
      Navigator.of(context).pop();
    }
  }

  void _showPrivacyInfo() {
    showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(ref.t('listeningScreen.takingNotes')),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('• ${ref.t('listeningScreen.dataSafeTooltip.noAudioRecordings')}'),
            Text('• ${ref.t('listeningScreen.dataSafeTooltip.dataEncrypted')}'),
            Text('• ${ref.t('listeningScreen.dataSafeTooltip.noTrainingData')}'),
            Text('• ${ref.t('listeningScreen.dataSafeTooltip.personalInfoRemoved')}'),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(), child: Text(ref.t('common.close'))),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: !_hasLiveSession,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop) _handleBackPress();
      },
      child: Scaffold(
        body: Column(
          children: [
            TabScreenHeader(
              title: ref.t('scribe.title'),
              leading: IconButton(
                icon: const Icon(Icons.arrow_back),
                onPressed: _handleBackPress,
              ),
            ),
            Expanded(child: _buildBody()),
          ],
        ),
      ),
    );
  }

  Widget _buildBody() {
    if (_disconnectedType != null) {
      return NetworkDisconnected(
        type: _disconnectedType!,
        isOffline: false,
        onTryAgain: _handleTryAgain,
        onGoBack: () => Navigator.of(context).pop(),
      );
    }

    if (_permissionDenied || _error != null) {
      final message = _permissionDenied ? ref.t('errors.permission') : _error!;
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(message, style: const TextStyle(color: AppColors.red400), textAlign: TextAlign.center),
        ),
      );
    }

    if (_chatId == null || _startedAt == null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const CircularProgressIndicator(),
            const SizedBox(height: 16),
            Text(ref.t('listeningScreen.connecting')),
          ],
        ),
      );
    }

    final canToggleFocusMode =
        ref.watch(userPermissionsProvider).value?.contains(UserPermissions.viewReferenceDocument) ??
        false;

    return Column(
      children: [
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                InkWell(
                  onTap: _showPrivacyInfo,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      SvgPicture.asset('assets/icons/lock.svg', width: 16, height: 16),
                      const SizedBox(width: 4),
                      Text(ref.t('listeningScreen.takingNotes')),
                    ],
                  ),
                ),
                const SizedBox(height: 8),
                ElapsedTimer(startTime: _startedAt!),
                const SizedBox(height: 16),
                AudioWaveformContainer(
                  amplitudes: _amplitudes,
                  isPaused: _isCallPaused,
                  isFocusMode: _isFocusMode,
                ),
                if (_isFocusMode) ...[
                  const SizedBox(height: 16),
                  Text(
                    ref.t('listeningScreen.microphoneModeNote'),
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ] else ...[
                  const SizedBox(height: 16),
                  // Tenant gate: mirrors RN's `!!nudgeStatus && currentNudge`
                  // — nudge content itself still arrives over the socket
                  // stream regardless of this flag (see
                  // `nudge_status_provider`'s doc comment); only whether it's
                  // shown is gated here, same as RN.
                  if ((ref.watch(nudgeStatusProvider).value ?? false) &&
                      (_currentNudge != null || _isNudgeLoading))
                    NudgeSection(nudge: _currentNudge, isLoading: _isNudgeLoading),
                  const SizedBox(height: 16),
                  ..._buildTranscript(),
                ],
                const SizedBox(height: 24),
                ListeningControls(
                  isCallPaused: _isCallPaused,
                  onPauseResumePress: _togglePauseResume,
                  onCallEndPress: _showEndConfirmation,
                  showFocusModeButton: canToggleFocusMode,
                  isFocusMode: _isFocusMode,
                  onFocusModeButtonPress: () => setState(() => _isFocusMode = !_isFocusMode),
                  showMuteTooltip: _isCallPaused && _isMuteTooltipOpen,
                  onDismissMuteTooltip: () => setState(() => _isMuteTooltipOpen = false),
                  isEnding: _isEnding,
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  List<Widget> _buildTranscript() {
    final all = [..._myTranscriptions, ..._speakerTranscriptions]
      ..sort((a, b) => a.timestamp.compareTo(b.timestamp));
    if (all.isEmpty) return const [];

    return [
      for (final t in all)
        CallTranscriptItem(
          time: _elapsedLabel(t.timestamp),
          message: t.message,
          counselor: t.senderId == _userIdAsInt,
        ),
    ];
  }

  String _elapsedLabel(String timestamp) {
    final start = _startedAt;
    final messageTime = DateTime.tryParse(timestamp);
    if (start == null || messageTime == null) return '';
    final elapsed = messageTime.difference(start);
    final seconds = elapsed.inSeconds < 0 ? 0 : elapsed.inSeconds;
    String pad(int n) => n.toString().padLeft(2, '0');
    return '${pad(seconds ~/ 3600)}:${pad((seconds ~/ 60) % 60)}:${pad(seconds % 60)}';
  }
}
