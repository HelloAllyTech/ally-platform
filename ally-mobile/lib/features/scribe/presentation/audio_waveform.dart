import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/rn_scale.dart';

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

/// Direct port of RN's `exotelAudioDataToAmplitudes` — the waveform math
/// for a cloud-telephony (Exotel/Ozonetel) conference call's `AUDIO_STREAM`
/// socket payload, used by `ConferenceListeningScreen` instead of
/// [pcmBytesToAmplitudes]. Confirmed a genuinely different function, not a
/// parameter variant: raw unsigned 8-bit byte averages normalized by /255,
/// no WAV-header handling, no signed-16-bit PCM decode, no global-max
/// rescale, and no platform gain — the server sends a simpler, raw byte
/// stream shape than the local PCM16 microphone capture does.
List<double> exotelBytesToAmplitudes(Uint8List bytes, {required int numBars}) {
  if (bytes.isEmpty || numBars <= 0) {
    return List.filled(numBars.clamp(0, numBars), 0.0);
  }

  final samplesPerBar = (bytes.length / numBars).floor().clamp(1, bytes.length);
  final amplitudes = <double>[];

  for (var i = 0; i < numBars; i++) {
    var sum = 0;
    var count = 0;
    for (var j = 0; j < samplesPerBar; j++) {
      final idx = i * samplesPerBar + j;
      if (idx < bytes.length) {
        sum += bytes[idx];
        count++;
      }
    }
    final avg = count > 0 ? sum / count : 0;
    amplitudes.add(avg / 255);
  }

  return amplitudes;
}

/// Flat, silent bar row — shown while paused, mirroring RN's
/// `SILENT_AMPLITUDES`.
List<double> silentAmplitudes(int numBars) => List.filled(numBars, 0.02);

/// RN `TINY_BAR_HEIGHT`: the at-rest bar (`SILENT_AMPLITUDES`).
const tinyBarHeight = 0.08;

/// RN `shapeAmplitudes`: tapers a frame towards both edges so it reads as
/// one shape; a silent or missing frame collapses to the flat rest row.
List<double> shapeAmplitudes(List<double>? amplitudes, int numBars) {
  final silent = amplitudes == null || amplitudes.isEmpty || amplitudes.every((a) => a.abs() < 0.001);
  if (silent) return List.filled(numBars, tinyBarHeight);
  final total = amplitudes.length;
  final middle = total ~/ 2;
  return [
    for (var i = 0; i < total; i++)
      amplitudes[i] == 0.02
          ? amplitudes[i]
          : i < middle
          ? amplitudes[i] * (i + 1) * 2 / total
          : amplitudes[i] * (total - i) * 1.5 / total,
  ];
}

/// Port of RN's `AudioWaveformContainer` + `AudioWaveform`: every 120 ms
/// the latest frame is shaped ([shapeAmplitudes]) and drawn as white,
/// 2-radius bars that ease to their new height over 100 ms — 2.5 wide / 2
/// apart and up to 70 tall in focus mode, 1 / 1.2 and up to ~36 otherwise —
/// left-aligned in a 50-tall, 10vs-padded strip that clips them, with the
/// `darkGray7` page colour faded over both ends. While [isPaused] it rests
/// on the flat row and stops polling ("a paused session should cost
/// nothing").
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
  static const _maxHeight = 50.0;

  Timer? _timer;
  List<double> _displayed = const [];

  int get _numBars => widget.amplitudes.value.isNotEmpty
      ? widget.amplitudes.value.length
      : numWaveformBars(MediaQuery.maybeSizeOf(context)?.width ?? 360);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_timer == null && _displayed.isEmpty) _startOrStopTimer();
  }

  @override
  void didUpdateWidget(covariant AudioWaveformContainer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.isPaused != widget.isPaused) _startOrStopTimer();
  }

  void _startOrStopTimer() {
    _timer?.cancel();
    _timer = null;
    _displayed = List.filled(_numBars, tinyBarHeight);
    if (widget.isPaused) {
      if (mounted) setState(() {});
      return;
    }
    _timer = Timer.periodic(const Duration(milliseconds: 120), (_) {
      if (mounted) setState(() => _displayed = shapeAmplitudes(widget.amplitudes.value, _numBars));
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final focus = widget.isFocusMode;
    final barWidth = focus ? 2.5 : 1.0;
    final barMargin = focus ? 2.0 : 1.2;
    final maxBarHeight = focus ? _maxHeight * 1.4 : _maxHeight / 1.4;
    final verticalPadding = RnSize.of(context).vs(10);
    return SizedBox(
      key: const ValueKey('audio-waveform-container'),
      height: _maxHeight,
      width: double.infinity,
      child: ClipRect(
        child: Stack(
          children: [
            Positioned.fill(
              child: Padding(
                padding: EdgeInsets.symmetric(vertical: verticalPadding),
                child: OverflowBox(
                  alignment: Alignment.centerLeft,
                  maxWidth: double.infinity,
                  maxHeight: double.infinity,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      for (final amplitude in _displayed)
                        Padding(
                          padding: EdgeInsets.symmetric(horizontal: barMargin / 2),
                          child: AnimatedContainer(
                            duration: const Duration(milliseconds: 100),
                            width: barWidth,
                            height: (amplitude * maxBarHeight).clamp(0.0, maxBarHeight),
                            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(2)),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
            const Positioned.fill(
              child: IgnorePointer(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [
                        AppColors.darkGray7,
                        Color(0x0017181A),
                        Color(0x0017181A),
                        Color(0x0017181A),
                        AppColors.darkGray7,
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
