import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:record/record.dart';

import '../../../core/chat/current_chat_provider.dart';
import '../../../core/config/app_config.dart';
import '../../../core/localization/translate_ref.dart';
import '../../../core/permissions/permissions_repository.dart';
import '../../../core/permissions/user_permissions.dart';
import '../../../core/realtime/connectivity.dart';
import '../../../core/realtime/foreground_recording_service.dart';
import '../../../core/realtime/keep_awake.dart';
import '../../../core/realtime/microphone_permission.dart';
import '../../../core/realtime/socket_events.dart';
import '../../../core/realtime/socket_service.dart';
import '../../../core/settings/settings_repository.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/rn_scale.dart';
import '../../../core/app_update/force_update.dart';
import '../../roleplay/presentation/call_modals.dart';
import '../data/chat_models.dart';
import '../data/chat_repository.dart';
import '../data/transcript_logic.dart';
import 'audio_waveform.dart';
import 'call_transcript_item.dart';
import 'elapsed_timer.dart';
import 'listening_chrome.dart';
import 'listening_controls.dart';
import 'network_disconnected.dart';
import 'nudge_section.dart';
import 'scribe_reference_search.dart';

/// Port of ally-mobile (React Native)'s `MicrophoneListeningScreen.tsx` +
/// `hooks/useListeningCommon.ts` + `hooks/useLiveAudioStream.ts` — Scribe's
/// live recording screen.
///
/// Look: RN's full-bleed dark page with a light status bar and no header;
/// focus mode (default) centres lock + "Taking notes", the HH:MM:SS timer,
/// the large waveform and the microphone note; non-focus mode puts the
/// label/timer beside a compact waveform, then the nudge and the live
/// transcript (mm:ss + You/Client, auto-scrolling); [ListeningControls]
/// floats at the bottom.
///
/// Behaviour, as RN:
/// - The socket connects on mount whatever the microphone says; the mic is
///   requested separately, and a refusal shows the "Allow microphone"
///   settings alert (Cancel leaves). Permission granted later in Settings is
///   picked up when the app returns to the foreground.
/// - `USER_JOINED` carries the chat id: it is used at once (RN fixed a race
///   where waiting for the GET left a live session showing "Microphone
///   failure" at 5 s), then the chat is hydrated from
///   `GET /chats/counsellor-chat`.
/// - The session starts PAUSED with the "Resume to let it listen" tooltip
///   on the controls; pause/resume is debounced 500 ms.
/// - Offline (connectivity_plus) shows the NETWORK view; a socket drop is
///   NETWORK when offline, SOCKET otherwise. The socket reconnects when the
///   app returns to the foreground, which also re-checks the chat: if it
///   ended meanwhile the counsellor goes to box breathing.
/// - A web-microphone session (started on the web app) is shown but not
///   streamed: no local audio, pause disabled, no disconnect states.
/// - Ending goes to box breathing whether or not `POST /chats/:id/end`
///   succeeds; leaving without a live session clears the current chat.
/// - The screen is kept awake throughout (RN `activateKeepAwake`).
///
/// The reference-document search sits under the nudge in non-focus mode
/// (`ScribeReferenceSearch`, RN `components/Search`), and RN's temporary
/// `SCRIBE_START_DIAGNOSTIC` telemetry fires at 5s/15s if the session
/// hasn't started.
class ScribeRecordingScreen extends ConsumerStatefulWidget {
  const ScribeRecordingScreen({super.key, required this.userId});

  final String userId;

  @override
  ConsumerState<ScribeRecordingScreen> createState() => _ScribeRecordingScreenState();
}

class _ScribeRecordingScreenState extends ConsumerState<ScribeRecordingScreen> with WidgetsBindingObserver {
  static const _chatIdTimeout = Duration(seconds: 5);
  static const _pauseDebounce = Duration(milliseconds: 500);
  static const _foregroundCheckDelay = Duration(milliseconds: 500);

  final AudioRecorder _recorder = AudioRecorder();
  final ScrollController _transcriptScroll = ScrollController();

  // Resolved once up front rather than via `ref.read(...)` inside
  // `dispose()` — same fix, for the same reason, as
  // `roleplay_voice_screen.dart`'s `_liveKitService`.
  late final SocketService _socketService;
  late final KeepAwake _keepAwake;

  bool _isMicrophoneModeSessionCreated = false;
  bool _isAudioChatEmitted = false;
  bool _isIntentionalDisconnect = false;
  bool _isPermissionGranted = false;
  bool _hasRequestedPermission = false;

  /// RN `chatData` (`state.chat.currentChat`): seeded from the current chat
  /// when one is already known (e.g. active-chat discovery opened this
  /// screen), then updated by `USER_JOINED`.
  int? _chatId;
  Chat? _chat;

  bool _isCallPaused = true;
  bool _isMuteTooltipOpen = true;
  Timer? _pauseDebounceTimer;

  List<Transcription> _myTranscriptions = [];
  List<Transcription> _speakerTranscriptions = [];

  /// Both buckets merged in timestamp order — the one list the live
  /// transcript renders. A notifier, so a streamed partial rebuilds only
  /// the transcript list, not the waveform/nudge/search/controls (and
  /// nothing at all in focus mode, where the transcript isn't shown).
  final ValueNotifier<List<Transcription>> _transcript = ValueNotifier(const []);

  /// [_elapsedLabel] results by message timestamp, for [_elapsedLabelsFor]
  /// (the chat's `startedAt`) — each label is parsed once, not on every
  /// partial for every line.
  final Map<String, String> _elapsedLabels = {};
  String? _elapsedLabelsFor;

  void _publishTranscript() {
    _transcript.value = [..._myTranscriptions, ..._speakerTranscriptions]
      ..sort((a, b) => a.timestamp.compareTo(b.timestamp));
  }

  Nudge? _currentNudge;
  bool _isNudgeLoading = false;

  DisconnectedType? _disconnectedType;
  Timer? _chatIdTimeoutTimer;

  bool _isFocusMode = true;

  final ValueNotifier<List<double>> _amplitudes = ValueNotifier(const []);
  int? _numBars;

  bool _isEnding = false;
  bool _hasStartedRecording = false;
  bool _hasLeft = false;
  bool _isOffline = false;
  ProviderSubscription<AsyncValue<bool>>? _offlineSubscription;

  bool get _isWebMicrophoneMode => _chat?.isWebMicrophoneMode ?? false;

  /// RN `useLiveAudioStream.permissionStatus` (react-native-permissions
  /// RESULTS: 'unavailable' until checked).
  String _permissionStatus = 'unavailable';

  /// RN's temporary SCRIBE_START_DIAGNOSTIC timers (5s and 15s).
  final List<Timer> _diagnosticTimers = [];
  final Set<int> _diagnosticSent = {};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _socketService = ref.read(socketServiceProvider);
    _keepAwake = ref.read(keepAwakeProvider);
    _keepAwake.activate();

    final current = ref.read(currentChatProvider);
    if (current != null && current.provider == ChatProvider.microphone) {
      _chat = current;
      _chatId = current.chatId;
      _rehydrate(current);
    }

    _offlineSubscription = ref.listenManual<AsyncValue<bool>>(isOfflineProvider, (_, next) {
      final offline = next.value ?? false;
      _isOffline = offline;
      if (offline && !_isWebMicrophoneMode && mounted) {
        setState(() => _disconnectedType = DisconnectedType.network);
      }
    }, fireImmediately: true);

    if (_chatId == null) _armChatIdTimeout();
    _connectSocket();
    if (!_isWebMicrophoneMode) _requestMicrophone();
    // 5s matches when the microphone-failure view appears; 15s catches
    // counsellors who wait rather than back out.
    for (final afterMs in const [5000, 15000]) {
      _diagnosticTimers.add(Timer(Duration(milliseconds: afterMs), () => _sendStartDiagnostic(afterMs)));
    }
  }

  /// RN `SCRIBE_START_DIAGNOSTIC`: once per mark, unless the session really
  /// started (audio chat emitted with a chat id), report the start gates.
  Future<void> _sendStartDiagnostic(int afterMs) async {
    if (!mounted || _diagnosticSent.contains(afterMs)) return;
    if (_isAudioChatEmitted && _chatId != null) return;
    _diagnosticSent.add(afterMs);
    String appVersion = '';
    try {
      appVersion = await ref.read(appVersionProvider.future);
    } catch (_) {}
    if (!mounted) return;
    _socketService.emit(SocketEvent.scribeStartDiagnostic, {
      'afterMs': afterMs,
      'appVersion': appVersion,
      'isPermissionGranted': _isPermissionGranted,
      'permissionStatus': _permissionStatus,
      'isMicrophoneModeSessionCreated': _isMicrophoneModeSessionCreated,
      'isWebMicrophoneMode': _isWebMicrophoneMode,
      'isAudioChatEmitted': _isAudioChatEmitted,
      'hasChatId': _chatId != null,
      'isOffline': _isOffline,
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // RN NUM_BARS: sized to the screen width (the strip clips the rest).
    _numBars ??= numWaveformBars(MediaQuery.sizeOf(context).width);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _offlineSubscription?.close();
    _keepAwake.deactivate();
    _chatIdTimeoutTimer?.cancel();
    _pauseDebounceTimer?.cancel();
    for (final timer in _diagnosticTimers) {
      timer.cancel();
    }
    _isIntentionalDisconnect = true;
    if (_hasStartedRecording) _recorder.stop();
    _recorder.dispose();
    _socketService.disconnect();
    ForegroundRecordingService.stop();
    _amplitudes.dispose();
    _transcriptScroll.dispose();
    _transcript.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed || !mounted) return;
    // RN useSocketConnection: reconnect on foreground (the mic socket is
    // never dropped on background, but it may have died meanwhile).
    _connectSocket();
    // RN useLiveAudioStream: permission granted from Settings meanwhile.
    if (!_isPermissionGranted && !_isWebMicrophoneMode) _checkMicrophone(request: false);
    // RN useListeningCommon: a session that ended while backgrounded.
    Timer(_foregroundCheckDelay, _checkChatStillActive);
  }

  void _armChatIdTimeout() {
    _chatIdTimeoutTimer?.cancel();
    _chatIdTimeoutTimer = Timer(_chatIdTimeout, () {
      if (mounted && _chatId == null) {
        setState(() => _disconnectedType = DisconnectedType.microphoneFailure);
      }
    });
  }

  Future<void> _connectSocket() {
    return _socketService.connect(
      namespacePath: AppConfig.microphoneSocketPath,
      userId: widget.userId,
      onConnect: () {},
      onDisconnect: (reason) {
        if (!mounted || _isIntentionalDisconnect || _isWebMicrophoneMode) return;
        setState(() => _disconnectedType = _isOffline ? DisconnectedType.network : DisconnectedType.socket);
      },
      onConnectionError: (error) {
        if (!mounted || _isWebMicrophoneMode) return;
        setState(() => _disconnectedType = DisconnectedType.socket);
      },
      eventCallbacks: {
        SocketEvent.sessionCreated: (_) {
          if (!mounted) return;
          setState(() => _isMicrophoneModeSessionCreated = true);
          _maybeEmitStartAudioChat();
        },
        SocketEvent.userJoined: _onUserJoined,
        SocketEvent.chatEnded: (_) => _goToBreathing(),
        SocketEvent.nudge: _onNudge,
        SocketEvent.messageReceived: _onMessageReceived,
        SocketEvent.utteranceEnded: _onUtteranceEnded,
      },
    );
  }

  Future<void> _requestMicrophone() => _checkMicrophone(request: true);

  /// RN `useLiveAudioStream.checkPermission`: granted → start streaming;
  /// otherwise (first time only) request, and on refusal show the settings
  /// alert whose Cancel leaves the screen.
  Future<void> _checkMicrophone({required bool request}) async {
    final status = await Permission.microphone.status;
    if (!mounted) return;
    _permissionStatus = _rnPermissionResult(status);
    if (status.isGranted) {
      await _startStreaming();
      return;
    }
    if (!request || _hasRequestedPermission) return;
    _hasRequestedPermission = true;
    final result = await requestMicrophonePermission();
    if (!mounted) return;
    _permissionStatus = result == MicrophonePermissionResult.granted ? 'granted' : 'denied';
    if (result == MicrophonePermissionResult.granted) {
      await _startStreaming();
      return;
    }
    await showPermissionSettingsAlert(
      context,
      title: ref.tr('simulationPage.allowMicrophone'),
      message: ref.tr('simulationPage.microphonePrompt'),
      cancelLabel: ref.tr('common.cancel'),
      settingsLabel: ref.tr('common.ok'),
      onCancel: _handleGoBack,
    );
  }

  Future<void> _startStreaming() async {
    if (_hasStartedRecording || _isWebMicrophoneMode) return;
    _hasStartedRecording = true;
    setState(() => _isPermissionGranted = true);
    _maybeEmitStartAudioChat();
    // Required on Android 13+ for the foreground service's own persistent
    // notification.
    await Permission.notification.request();
    if (!mounted) return;
    await ForegroundRecordingService.start(
      notificationTitle: ref.tr('scribe.notificationTitle'),
      notificationText: ref.tr('scribe.notificationText'),
    );
    if (!mounted) return;
    // MICROPHONE_AUDIO_SAMPLE_RATE / channels / bitsPerSample in RN's
    // constants/general.ts — the backend's audio pipeline expects this.
    final stream = await _recorder.startStream(
      const RecordConfig(encoder: AudioEncoder.pcm16bits, sampleRate: 16000, numChannels: 1),
    );
    stream.listen(_onAudioChunk);
  }

  void _onAudioChunk(Uint8List chunk) {
    // Computed on every chunk, independent of pause — RN's `handleAudioData`.
    _amplitudes.value = pcmBytesToAmplitudes(
      chunk,
      numBars: _numBars ?? numWaveformBars(360),
      platformGain: defaultTargetPlatform == TargetPlatform.iOS ? 3.0 : 1.0,
    );
    // Deliberately NOT gated on the socket's connected state: socket.io
    // buffers frames across a transient disconnect (RN's own warning).
    final chatId = _chatId;
    if (!_isCallPaused && !_isWebMicrophoneMode && chatId != null) {
      _socketService.emit(SocketEvent.audioMessage, {'audioData': base64Encode(chunk), 'chatId': chatId});
    }
  }

  /// RN `isAudioSessionReady && !isAudioChatEmitted`.
  void _maybeEmitStartAudioChat() {
    if (!_isPermissionGranted || !_isMicrophoneModeSessionCreated || _isWebMicrophoneMode || _isAudioChatEmitted) {
      return;
    }
    _isAudioChatEmitted = true;
    _socketService.emit(SocketEvent.startAudioChat, {
      'isLinear16Encoded': true,
      'platform': AllyPlatform.mobile,
      'sampleRate': 16000,
      'mode': 'SCRIBE',
    });
  }

  /// RN `USER_JOINED`: take `payload.chatId` straight away
  /// (`setCurrentChatId`), then hydrate via `checkCounselorChat()`.
  Future<void> _onUserJoined(dynamic data) async {
    final payload = data is Map ? data['payload'] : null;
    final joinedChatId = payload is Map ? (payload['chatId'] as num?)?.toInt() : null;
    if (joinedChatId != null && mounted) {
      _chatIdTimeoutTimer?.cancel();
      setState(() => _chatId = joinedChatId);
    }
    Chat? chat;
    try {
      chat = await ref.read(chatRepositoryProvider).getCounsellorChat();
    } catch (_) {
      chat = null;
    }
    // An empty response doesn't clear the id USER_JOINED just gave us (RN
    // runs this check as the Listening route, which preserves the chat).
    if (!mounted || chat == null) return;
    _chatIdTimeoutTimer?.cancel();
    ref.read(currentChatProvider.notifier).set(chat);
    setState(() {
      _chat = chat;
      _chatId = chat!.chatId;
    });
    _rehydrate(chat);
  }

  void _rehydrate(Chat chat) {
    if (chat.messages.isEmpty) return;
    final rehydrated = rehydrateTranscriptions(chat.messages, _userIdAsInt ?? -1);
    _myTranscriptions = rehydrated.mine;
    _speakerTranscriptions = rehydrated.theirs;
    _publishTranscript();
    _scrollTranscriptToEnd();
  }

  /// RN `useListeningCommon` AppState effect: back in the foreground, a
  /// chat that's gone means the session ended — go to box breathing.
  Future<void> _checkChatStillActive() async {
    if (!mounted || _hasLeft) return;
    final permissions = ref.read(userPermissionsProvider).value ?? const <String>[];
    if (!_isWebMicrophoneMode &&
        !_isPermissionGranted &&
        !permissions.contains(UserPermissions.viewCounselorChat)) {
      return;
    }
    Chat? chat;
    try {
      chat = await ref.read(chatRepositoryProvider).getCounsellorChat();
    } catch (_) {
      return;
    }
    if (chat == null) _goToBreathing();
  }

  void _onNudge(dynamic data) {
    final payload = data is Map ? data['payload'] : null;
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
    if (transcription.senderId == _userIdAsInt) {
      _myTranscriptions = processTranscription(_myTranscriptions, transcription);
    } else {
      _speakerTranscriptions = processTranscription(_speakerTranscriptions, transcription);
    }
    _publishTranscript();
    _scrollTranscriptToEnd();
  }

  void _onUtteranceEnded(dynamic data) {
    final payload = data is Map ? data['payload'] ?? data : null;
    final senderId = payload is Map ? (payload['senderId'] as num?)?.toInt() : null;
    if (senderId == _userIdAsInt) {
      _myTranscriptions = markLastTranscriptionComplete(_myTranscriptions);
    } else {
      _speakerTranscriptions = markLastTranscriptionComplete(_speakerTranscriptions);
    }
    _publishTranscript();
  }

  /// RN ScrollView `onContentSizeChange → scrollToEnd({animated: true})`.
  void _scrollTranscriptToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_transcriptScroll.hasClients) return;
      _transcriptScroll.animateTo(
        _transcriptScroll.position.maxScrollExtent,
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOut,
      );
    });
  }

  /// RN `useDebounce(..., {delay: 500})` (trailing): the toggle lands 500 ms
  /// after the last tap, so rapid taps don't flip it back and forth.
  void _onPauseResumePressed() {
    _pauseDebounceTimer?.cancel();
    _pauseDebounceTimer = Timer(_pauseDebounce, () {
      if (!mounted) return;
      setState(() {
        _isCallPaused = !_isCallPaused;
        if (!_isCallPaused) _isMuteTooltipOpen = false;
      });
    });
  }

  bool _showEndConfirmation = false;

  /// RN `handleEndCall`: stop the stream, `POST /chats/:id/end`, and go to
  /// box breathing on success AND on error.
  Future<void> _endSession() async {
    final chatId = _chatId;
    if (chatId == null || _isEnding) return;
    setState(() => _isEnding = true);
    _isIntentionalDisconnect = true;
    try {
      if (_hasStartedRecording && !_isWebMicrophoneMode) {
        await _recorder.stop();
        _hasStartedRecording = false;
      }
      await ForegroundRecordingService.stop();
      await ref.read(chatRepositoryProvider).endCall(chatId);
    } catch (_) {
      // RN redirects on `isEndCallError` too.
    } finally {
      _socketService.disconnect();
      _goToBreathing();
    }
  }

  /// RN `handleCallEndRedirection`: replace with Breathing.
  void _goToBreathing() {
    if (!mounted || _hasLeft) return;
    _hasLeft = true;
    final chatId = _chatId;
    GoRouter.maybeOf(context)?.go(chatId != null ? '/box-breathing?chatId=$chatId' : '/box-breathing');
  }

  /// RN `handleGoBack`: clear the current chat, then go back.
  void _handleGoBack() {
    if (!mounted || _hasLeft) return;
    _hasLeft = true;
    ref.read(currentChatProvider.notifier).set(null);
    final navigator = Navigator.of(context);
    if (navigator.canPop()) {
      navigator.pop();
    } else {
      GoRouter.maybeOf(context)?.go('/home');
    }
  }

  void _handleTryAgain() {
    setState(() => _disconnectedType = null);
    _handleGoBack();
  }

  bool get _hasLiveSession => _chatId != null && _disconnectedType == null;

  /// RN `handleHardwareBackPress`.
  void _handleBackPress() {
    if (!_hasLiveSession) {
      _handleGoBack();
    } else if (!_showEndConfirmation) {
      setState(() => _showEndConfirmation = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop) _handleBackPress();
      },
      child: ListeningPage(child: _buildBody()),
    );
  }

  Widget _buildBody() {
    final disconnected = _disconnectedType;
    if (disconnected != null) {
      return NetworkDisconnected(type: disconnected, onTryAgain: _handleTryAgain, onGoBack: _handleGoBack);
    }
    if (_chatId == null) {
      return ListeningConnectingView(onCancel: _handleGoBack);
    }

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
            isCallPaused: _isCallPaused,
            onPauseResumePress: _onPauseResumePressed,
            onCallEndPress: () => setState(() => _showEndConfirmation = true),
            showFocusModeButton: canToggleFocusMode,
            isFocusMode: _isFocusMode,
            onFocusModeButtonPress: () => setState(() => _isFocusMode = !_isFocusMode),
            showMuteTooltip: _isCallPaused && !_isWebMicrophoneMode && _isMuteTooltipOpen,
            onDismissMuteTooltip: () => setState(() => _isMuteTooltipOpen = false),
            isPauseResumeDisabled: _isWebMicrophoneMode,
            isEnding: _isEnding,
          ),
        ),
        // RN `CallEndConfirmationModal` (microphone copy).
        if (_showEndConfirmation)
          CallIllustratedModal(
            titleMain: ref.t('audioCall.endDialog.titleNormal'),
            titleItalic: ref.t('audioCall.endDialog.titleItalic'),
            description: ref.t('audioCall.endDialog.content'),
            illustrationAsset: 'assets/icons/endSession.svg',
            actionLabel: ref.t('audioCall.endDialog.endSession'),
            onAction: _endSession,
            onClose: () => setState(() => _showEndConfirmation = false),
          ),
      ],
    );
  }

  DateTime get _startTime => DateTime.tryParse(_chat?.startedAt ?? '') ?? _mountedAt;
  final DateTime _mountedAt = DateTime.now();

  /// RN `renderFocusMode` (`styles.focusModeLayout`: centred, 100vs bottom
  /// padding; waveform 96% wide, 40vs below the timer).
  Widget _buildFocusMode() {
    final rn = RnSize.of(context);
    return Padding(
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
                child: AudioWaveformContainer(amplitudes: _amplitudes, isPaused: _isCallPaused, isFocusMode: true),
              ),
            ),
            if (!_isWebMicrophoneMode)
              Padding(
                padding: EdgeInsets.only(top: rn.vs(15), left: rn.s(25), right: rn.s(25)),
                child: Text(
                  ref.t('listeningScreen.microphoneModeNote'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontFamily: AppFonts.ibmPlexSerifRegular, fontSize: 14, color: Colors.white),
                ),
              ),
          ],
        ),
      ),
    );
  }

  /// RN `renderNonFocusMode` (`styles.nonFocusModeLayout`: 40vs from the
  /// top, 20s side padding): label + timer beside a half-width waveform,
  /// the nudge, then the transcript.
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
                child: AudioWaveformContainer(amplitudes: _amplitudes, isPaused: _isCallPaused, isFocusMode: false),
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
          // RN `<Search />` (flex 1) shares the space with the transcript.
          const Expanded(child: ScribeReferenceSearch()),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(top: rn.vs(15)),
              child: ValueListenableBuilder<List<Transcription>>(
                valueListenable: _transcript,
                // Builder: only the lines in view are built per partial.
                builder: (context, all, _) => ListView.builder(
                  key: const ValueKey('live-transcript'),
                  controller: _transcriptScroll,
                  padding: EdgeInsets.only(bottom: rn.vs(20)),
                  itemCount: all.length,
                  itemBuilder: (context, index) {
                    final t = all[index];
                    return CallTranscriptItem(
                      key: ValueKey(t.id),
                      time: _elapsedLabel(t.timestamp),
                      message: t.message,
                      counselor: t.senderId == _userIdAsInt,
                      speakerLabel: ref.t(
                        t.senderId == _userIdAsInt ? 'transcription.youLabel' : 'transcription.clientLabel',
                      ),
                    );
                  },
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// RN `getElapsedSeconds`: mm:ss since `chat.startedAt` ("00:00" without
  /// one); minutes aren't capped at 59.
  String _elapsedLabel(String timestamp) {
    final startedAtRaw = _chat?.startedAt;
    if (_elapsedLabelsFor != startedAtRaw) {
      _elapsedLabels.clear();
      _elapsedLabelsFor = startedAtRaw;
    }
    return _elapsedLabels[timestamp] ??= _computeElapsedLabel(timestamp);
  }

  String _computeElapsedLabel(String timestamp) {
    final startedAt = DateTime.tryParse(_chat?.startedAt ?? '');
    final messageTime = DateTime.tryParse(timestamp);
    if (startedAt == null || messageTime == null) return '00:00';
    final diff = messageTime.difference(startedAt).inSeconds;
    final seconds = diff < 0 ? 0 : diff;
    String pad(int n) => n.toString().padLeft(2, '0');
    return '${pad(seconds ~/ 60)}:${pad(seconds % 60)}';
  }
}

/// react-native-permissions `RESULTS` names for a permission_handler status.
String _rnPermissionResult(PermissionStatus status) => switch (status) {
  PermissionStatus.granted => 'granted',
  PermissionStatus.limited => 'limited',
  PermissionStatus.permanentlyDenied || PermissionStatus.restricted => 'blocked',
  PermissionStatus.provisional => 'granted',
  PermissionStatus.denied => 'denied',
};
