import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';

/// Mirrors RN's `useVoiceNoteRecorder` (`src/hooks/useVoiceNoteRecorder.ts`)
/// `VoiceRecorderStatus` union exactly, minus RN's own naming of `'stopped'`
/// as the terminal "ready to generate" state — kept identical here too.
enum VoiceRecorderStatus { idle, recording, paused, stopped }

/// Mirrors RN's `VoiceRecorderError` union.
enum VoiceRecorderError { permission, generic }

/// Records a dictation to a mono 16kHz 16-bit WAV file with start/pause/
/// resume/stop controls, for the manual-scribe-note voice flow.
///
/// Unlike RN's hand-rolled version (which streams raw PCM chunks via
/// `react-native-live-audio-stream` and manually builds/patches a WAV
/// header, because that library has no file-writing mode of its own), this
/// uses the `record` package's own `AudioEncoder.wav` file-recording mode
/// directly — the same package `scribe_recording_screen.dart` already
/// depends on (there for its separate `startStream`/PCM mode, for live
/// upload over a socket). `AudioEncoder.wav` already writes a correctly
/// headered WAV file as it records, so no manual header math is needed here.
///
/// Sample rate/channels match RN's `MICROPHONE_AUDIO_SAMPLE_RATE` (16000,
/// mono) exactly — the backend's transcription endpoint expects this format.
class VoiceNoteRecorder extends ChangeNotifier {
  VoiceNoteRecorder({AudioRecorder? recorder}) : _recorder = recorder ?? AudioRecorder();

  final AudioRecorder _recorder;

  VoiceRecorderStatus status = VoiceRecorderStatus.idle;
  int durationMs = 0;
  String? filePath;
  VoiceRecorderError? error;

  Timer? _ticker;
  bool _disposed = false;

  Future<String> _newFilePath() async {
    final dir = await getTemporaryDirectory();
    // A fixed name (not a new one per recording) is fine: only one
    // in-flight dictation exists at a time, and `start()` always begins a
    // fresh file.
    return '${dir.path}/voice-note-dictation.wav';
  }

  void _startTicker() {
    _ticker?.cancel();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      durationMs += 1000;
      notifyListeners();
    });
  }

  void _stopTicker() {
    _ticker?.cancel();
    _ticker = null;
  }

  Future<void> start() async {
    error = null;
    try {
      if (!await _recorder.hasPermission()) {
        error = VoiceRecorderError.permission;
        status = VoiceRecorderStatus.idle;
        notifyListeners();
        return;
      }

      durationMs = 0;
      filePath = await _newFilePath();
      await _recorder.start(
        const RecordConfig(encoder: AudioEncoder.wav, sampleRate: 16000, numChannels: 1),
        path: filePath!,
      );
      status = VoiceRecorderStatus.recording;
      _startTicker();
    } catch (_) {
      error = VoiceRecorderError.generic;
      status = VoiceRecorderStatus.idle;
    }
    notifyListeners();
  }

  Future<void> pause() async {
    if (status != VoiceRecorderStatus.recording) return;
    _stopTicker();
    await _recorder.pause();
    status = VoiceRecorderStatus.paused;
    notifyListeners();
  }

  Future<void> resume() async {
    if (status != VoiceRecorderStatus.paused) return;
    await _recorder.resume();
    status = VoiceRecorderStatus.recording;
    _startTicker();
    notifyListeners();
  }

  Future<void> stop() async {
    if (status != VoiceRecorderStatus.recording && status != VoiceRecorderStatus.paused) return;
    _stopTicker();
    await _recorder.stop();
    status = VoiceRecorderStatus.stopped;
    notifyListeners();
  }

  /// Discards the recording, deletes the file, and releases the microphone —
  /// mirrors RN's `reset`.
  Future<void> reset() async {
    _stopTicker();
    try {
      if (status == VoiceRecorderStatus.recording || status == VoiceRecorderStatus.paused) {
        await _recorder.cancel();
      }
    } catch (_) {
      // Already stopped/never started — nothing to cancel.
    }
    final path = filePath;
    if (path != null) {
      final file = File(path);
      if (await file.exists()) {
        try {
          await file.delete();
        } catch (_) {
          // Best-effort cleanup only.
        }
      }
    }
    durationMs = 0;
    filePath = null;
    error = null;
    status = VoiceRecorderStatus.idle;
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _stopTicker();
    _recorder.dispose();
    super.dispose();
  }

  @override
  void notifyListeners() {
    if (_disposed) return;
    super.notifyListeners();
  }
}
