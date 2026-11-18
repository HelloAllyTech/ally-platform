import 'dart:typed_data';

import 'package:ally_mobile_flutter/features/scribe/data/pcm_segmenter.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  // 1 kHz mono 16-bit: 2,000 bytes a second, so a 2 s segment is 4,000 bytes.
  PcmSegmenter make(List<(int, Uint8List)> out, {int start = 0}) => PcmSegmenter(
    sampleRate: 1000,
    segmentSeconds: 2,
    startIndex: start,
    onSegment: (i, wav) => out.add((i, wav)),
  );

  test('cuts exact-length segments across chunk boundaries, with no gap', () {
    final out = <(int, Uint8List)>[];
    final seg = make(out);
    seg.add(Uint8List(3000));
    seg.add(Uint8List(3000));
    seg.add(Uint8List(2500));
    expect(out.map((e) => e.$1), [0, 1]);
    expect(out.map((e) => e.$2.length - 44), [4000, 4000]);
    seg.flush();
    expect(out.last.$1, 2);
    expect(out.last.$2.length - 44, 500);
    expect(seg.recordedSeconds, 4.25);
  });

  test('writes a canonical PCM WAV header', () {
    final wav = wavFromPcm(Uint8List(16000), sampleRate: 16000);
    final b = ByteData.sublistView(wav);
    expect(String.fromCharCodes(wav.sublist(0, 4)), 'RIFF');
    expect(String.fromCharCodes(wav.sublist(8, 12)), 'WAVE');
    expect(b.getUint32(4, Endian.little), 36 + 16000);
    expect(b.getUint16(20, Endian.little), 1); // PCM
    expect(b.getUint16(22, Endian.little), 1); // mono
    expect(b.getUint32(24, Endian.little), 16000);
    expect(b.getUint32(28, Endian.little), 32000);
    expect(b.getUint16(34, Endian.little), 16);
    expect(b.getUint32(40, Endian.little), 16000);
  });

  test('continues numbering after a restart, and flush with nothing buffered emits nothing', () {
    final out = <(int, Uint8List)>[];
    final seg = make(out, start: 12);
    seg.flush();
    expect(out, isEmpty);
    seg.add(Uint8List(4000));
    expect(out.single.$1, 12);
    expect(seg.nextIndex, 13);
  });
}
