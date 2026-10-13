import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:record/record.dart';

import '../../../core/config/app_config.dart';
import '../../../core/realtime/foreground_recording_service.dart';
import '../../../core/realtime/socket_events.dart';
import '../../../core/realtime/socket_service.dart';

/// Phase 1 proof: rebuild Scribe's live recording path first, since the
/// reliability problems that motivated this whole migration live here
/// (ally-mobile (React Native)'s `MicrophoneListeningScreen.tsx` +
/// `useSocket.ts`). This screen exercises the full real pipeline — mic
/// permission, foreground service (the actual Android 14+ fix), Socket.IO
/// connection, and chunked PCM audio streaming — not a mocked version of it.
///
/// Deliberately NOT a port of the full `MicrophoneListeningScreen` UI (nudge
/// banners, chat transcript, network-disconnected states, conference mode)
/// — that's real work for a later pass once this proves the transport layer
/// itself is reliable. What matters for the migration's central question is
/// here: does audio keep streaming when the screen is backgrounded.
class ScribeRecordingScreen extends ConsumerStatefulWidget {
  const ScribeRecordingScreen({super.key, required this.userId});

  final String userId;

  @override
  ConsumerState<ScribeRecordingScreen> createState() =>
      _ScribeRecordingScreenState();
}

class _ScribeRecordingScreenState
    extends ConsumerState<ScribeRecordingScreen> {
  final AudioRecorder _recorder = AudioRecorder();

  bool _isRecording = false;
  bool _isSocketConnected = false;
  int _chunksSent = 0;
  String? _error;

  @override
  void dispose() {
    _stopRecording();
    _recorder.dispose();
    super.dispose();
  }

  Future<void> _startRecording() async {
    setState(() => _error = null);

    final micStatus = await Permission.microphone.request();
    if (!micStatus.isGranted) {
      setState(() => _error = 'Microphone permission denied.');
      return;
    }
    // Required on Android 13+ for the foreground service's own persistent
    // notification; without it the service can still start but the user
    // gets no visible indicator that recording is active.
    await Permission.notification.request();

    final socketService = ref.read(socketServiceProvider);
    await socketService.connect(
      namespacePath: AppConfig.microphoneSocketPath,
      userId: widget.userId,
      onConnect: () {
        if (mounted) setState(() => _isSocketConnected = true);
      },
      onDisconnect: (reason) {
        if (mounted) setState(() => _isSocketConnected = false);
      },
      eventCallbacks: {
        SocketEvent.sessionCreated: (_) {},
        SocketEvent.chatEnded: (_) {},
      },
    );

    await ForegroundRecordingService.start(
      notificationTitle: 'Recording session',
      notificationText: 'Ally is recording this session.',
    );

    // Matches MICROPHONE_AUDIO_SAMPLE_RATE / channels / bitsPerSample in
    // ally-mobile's src/constants/general.ts exactly — the backend's audio
    // pipeline expects this specific format.
    final stream = await _recorder.startStream(
      const RecordConfig(
        encoder: AudioEncoder.pcm16bits,
        sampleRate: 16000,
        numChannels: 1,
      ),
    );

    socketService.emit(SocketEvent.startAudioChat, {});

    setState(() => _isRecording = true);

    stream.listen((chunk) {
      // RN's SocketEvent.AUDIO_MESSAGE payload is base64 audio data; mirrored
      // here rather than sending raw bytes, since the backend decoder is
      // unchanged by this rewrite.
      socketService.emit(SocketEvent.audioMessage, {
        'audio': base64Encode(chunk),
      });
      if (mounted) setState(() => _chunksSent++);
    });
  }

  Future<void> _stopRecording() async {
    if (!_isRecording) return;
    await _recorder.stop();
    ref.read(socketServiceProvider).disconnect();
    await ForegroundRecordingService.stop();
    if (mounted) {
      setState(() {
        _isRecording = false;
        _isSocketConnected = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Scribe recording (Phase 1)')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                _isRecording ? Icons.mic : Icons.mic_none,
                size: 64,
                color: _isRecording ? Colors.red : null,
              ),
              const SizedBox(height: 16),
              Text(_isRecording ? 'Recording' : 'Not recording'),
              Text(
                'Socket: ${_isSocketConnected ? "connected" : "disconnected"}',
              ),
              if (_isRecording) Text('Audio chunks sent: $_chunksSent'),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(_error!, style: const TextStyle(color: Colors.red)),
                ),
              const SizedBox(height: 24),
              FilledButton(
                onPressed: _isRecording ? _stopRecording : _startRecording,
                child: Text(_isRecording ? 'Stop' : 'Start recording'),
              ),
              const SizedBox(height: 16),
              const Text(
                'Lock the screen or switch apps while recording to verify '
                'the foreground service keeps audio chunks flowing — this '
                'is the exact failure mode this rewrite exists to fix.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12, color: Colors.grey),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
