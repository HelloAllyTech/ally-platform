import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/scribe/presentation/audio_waveform.dart';

Uint8List _pcm16(List<int> samples) {
  final bytes = Uint8List(samples.length * 2);
  for (var i = 0; i < samples.length; i++) {
    final value = samples[i] < 0 ? samples[i] + 0x10000 : samples[i];
    bytes[i * 2] = value & 0xff;
    bytes[i * 2 + 1] = (value >> 8) & 0xff;
  }
  return bytes;
}

void main() {
  group('numWaveformBars', () {
    test('floors screenWidth / (barWidth + barMargin)', () {
      expect(numWaveformBars(360), 80);
    });
  });

  group('pcmBytesToAmplitudes', () {
    test('silence (near-zero samples) floors every bar to 0.02', () {
      final silence = _pcm16(List.filled(200, 0));

      final amplitudes = pcmBytesToAmplitudes(silence, numBars: 10);

      expect(amplitudes, hasLength(10));
      expect(amplitudes, everyElement(0.02));
    });

    test('loud samples normalize up near 1.0, scaled by the global max', () {
      final loud = _pcm16(List.filled(200, 30000));

      final amplitudes = pcmBytesToAmplitudes(loud, numBars: 10);

      expect(amplitudes, hasLength(10));
      for (final a in amplitudes) {
        expect(a, closeTo(1.0, 0.05));
      }
    });

    test(
      'platformGain amplifies a quiet bar relative to a chunk-wide loud peak '
      '(iOS gets 3x in the real caller)',
      () {
        // Two bars: the first sets a loud `globalMax` (so the quiet second
        // bar's scaled-but-pre-gain value has headroom below 1.0, where a
        // gain difference is actually visible instead of both clamping to 1).
        final loudThenQuiet = _pcm16([
          ...List.filled(100, 30000),
          ...List.filled(100, 3000),
        ]);

        final withoutGain = pcmBytesToAmplitudes(loudThenQuiet, numBars: 2);
        final withGain = pcmBytesToAmplitudes(loudThenQuiet, numBars: 2, platformGain: 3.0);

        expect(withGain[1], greaterThan(withoutGain[1]));
      },
    );

    test('strips a RIFF/WAV header before reading PCM samples', () {
      final header = Uint8List.fromList([0x52, 0x49, 0x46, 0x46, ...List.filled(40, 0)]);
      final pcm = _pcm16(List.filled(200, 30000));
      final wrapped = Uint8List.fromList([...header, ...pcm]);

      final amplitudes = pcmBytesToAmplitudes(wrapped, numBars: 10);

      expect(amplitudes.first, closeTo(1.0, 0.05));
    });

    test('empty input returns silent amplitudes instead of crashing', () {
      final amplitudes = pcmBytesToAmplitudes(Uint8List(0), numBars: 5);

      expect(amplitudes, everyElement(0.02));
    });
  });

  group('silentAmplitudes', () {
    test('returns a flat row of 0.02 at the requested length', () {
      expect(silentAmplitudes(4), [0.02, 0.02, 0.02, 0.02]);
    });
  });
}
