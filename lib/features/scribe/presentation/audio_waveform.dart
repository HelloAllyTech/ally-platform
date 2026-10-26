import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';

const _barWidth = 2.5;
const _barMargin = 2.0;

/// Mirrors RN's `NUM_BARS = floor(SCREEN_WIDTH / (BAR_WIDTH + BAR_MARGIN))`
/// (`src/screens/ListeningScreen/utils/audioUtils.ts`) — a fixed bar count
/// sized to the device's screen width.
int numWaveformBars(double screenWidth) => (screenWidth / (_barWidth + _barMargin)).floor();

/// Direct port of RN's `recorderAudioToAmplitudes` — NOT decorative: this
/// turns one chunk of raw 16-bit PCM audio into [numBars] normalized bar
/// heights for the waveform, computed client-side from the actual audio
/// being streamed. Unlike RN (which receives base64-encoded, possibly
/// WAV-wrapped audio over a bridge callback), Flutter's `record` package
/// hands this screen raw PCM16 bytes directly from `AudioRecorder.startStream`
/// — so there's no base64 decode step, though the defensive RIFF-header
/// check is kept since it's cheap and RN's own code treats a WAV wrapper as
/// a real possibility.
///
/// [platformGain] mirrors RN's `PLATFORM_GAIN` (`isIOS ? 3.0 : 1.0` — iOS's
/// raw levels run quieter) — the caller supplies it rather than this
/// function reading `Platform.isIOS` itself, keeping this pure and testable
/// without touching platform APIs.
List<double> pcmBytesToAmplitudes(
  Uint8List pcmBytes, {
  required int numBars,
  double platformGain = 1.0,
}) {
  final isWav =
      pcmBytes.length >= 4 &&
      pcmBytes[0] == 0x52 && // R
      pcmBytes[1] == 0x49 && // I
      pcmBytes[2] == 0x46 && // F
      pcmBytes[3] == 0x46; // F
  final pcmData = isWav && pcmBytes.length > 44 ? pcmBytes.sublist(44) : pcmBytes;

  final sampleCount = pcmData.length ~/ 2;
  if (sampleCount == 0 || numBars <= 0) {
    return List.filled(numBars.clamp(0, numBars), 0.02);
  }

  final samples = Int16List(sampleCount);
  var globalMax = 0;
  for (var i = 0; i < sampleCount; i++) {
    final lo = pcmData[i * 2];
    final hi = pcmData[i * 2 + 1];
    final value = hi * 256 + lo;
    final sample = value >= 0x8000 ? value - 0x10000 : value;
    samples[i] = sample;
    if (sample.abs() > globalMax) globalMax = sample.abs();
  }

  final samplesPerBar = (sampleCount / numBars).floor().clamp(1, sampleCount);
  final scale = globalMax > 0 ? 1 / (globalMax / 32768) : 1.0;
  final amplitudes = <double>[];

  for (var i = 0; i < numBars; i++) {
    var sum = 0;
    var count = 0;
    for (var j = 0; j < samplesPerBar; j++) {
      final idx = i * samplesPerBar + j;
      if (idx < sampleCount) {
        sum += samples[idx].abs();
        count++;
      }
    }
    final avg = count > 0 ? sum / count : 0;
    var normalized = avg / 32768;
    normalized *= scale * platformGain;
    normalized = normalized > 1 ? 1 : normalized;
    if (globalMax < 500) normalized = 0.02;
    amplitudes.add(normalized < 0.02 ? 0.02 : normalized);
  }

  return amplitudes;
}

/// Flat, silent bar row — shown while paused, mirroring RN's
/// `SILENT_AMPLITUDES`.
List<double> silentAmplitudes(int numBars) => List.filled(numBars, 0.02);

/// Scoped port of RN's `AudioWaveformContainer` — redraws from
/// [amplitudes] on a 120ms timer (matching RN's own redraw interval) rather
/// than on every audio chunk (which arrives far more often), to keep this
/// cheap during a long recording. When [isPaused], freezes to a flat silent
/// row and stops polling entirely, same as RN's documented "paused costs
/// nothing" behavior.
///
/// Not ported: RN's Reanimated UI-thread shared-value optimization and
/// per-bar edge-tapering (`shapeAmplitudes`) — Flutter has no equivalent
/// perf concern for a 120ms `setState`, and the tapering is a cosmetic
/// polish disproportionate to port pixel-for-pixel for this pass.
class AudioWaveformContainer extends StatefulWidget {
  const AudioWaveformContainer({
    super.key,
    required this.amplitudes,
    required this.isPaused,
    this.isFocusMode = false,
  });

  /// Read on each 120ms tick — the caller updates this to the latest
  /// amplitude array on every audio chunk; this widget decides how often to
  /// actually redraw.
  final ValueListenable<List<double>> amplitudes;
  final bool isPaused;
  final bool isFocusMode;

  @override
  State<AudioWaveformContainer> createState() => _AudioWaveformContainerState();
}

class _AudioWaveformContainerState extends State<AudioWaveformContainer> {
  Timer? _timer;
  List<double> _displayed = const [];

  @override
  void initState() {
    super.initState();
    _displayed = widget.amplitudes.value;
    _startOrStopTimer();
  }

  @override
  void didUpdateWidget(covariant AudioWaveformContainer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.isPaused != widget.isPaused) _startOrStopTimer();
  }

  void _startOrStopTimer() {
    _timer?.cancel();
    if (widget.isPaused) {
      setState(() => _displayed = silentAmplitudes(widget.amplitudes.value.length));
      return;
    }
    _timer = Timer.periodic(const Duration(milliseconds: 120), (_) {
      if (mounted) setState(() => _displayed = widget.amplitudes.value);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final maxBarHeight = widget.isFocusMode ? 64.0 : 32.0;
    return SizedBox(
      key: const ValueKey('audio-waveform-container'),
      height: maxBarHeight,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          for (final amplitude in _displayed)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: _barMargin / 2),
              child: Container(
                width: _barWidth,
                height: (amplitude * maxBarHeight).clamp(2.0, maxBarHeight),
                decoration: BoxDecoration(
                  color: AppColors.primary,
                  borderRadius: BorderRadius.circular(_barWidth / 2),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
