import 'dart:typed_data';

/// Cuts the microphone's raw PCM stream into fixed-length WAV segments.
///
/// The recorder keeps streaming (no restart, so no gap between segments);
/// every [segmentSeconds] of audio is wrapped in a 44-byte WAV header and
/// handed to [onSegment] as a complete, standalone file.
class PcmSegmenter {
  PcmSegmenter({
    required this.onSegment,
    this.sampleRate = 16000,
    this.numChannels = 1,
    this.bitsPerSample = 16,
    this.segmentSeconds = 30,
    int startIndex = 0,
  }) : nextIndex = startIndex;

  final void Function(int index, Uint8List wav) onSegment;
  final int sampleRate;
  final int numChannels;
  final int bitsPerSample;
  final int segmentSeconds;

  /// Index the next segment gets.
  int nextIndex;

  /// Total PCM bytes recorded (for the recorded duration).
  int totalBytes = 0;

  final BytesBuilder _buffer = BytesBuilder(copy: false);

  int get _bytesPerSecond => sampleRate * numChannels * (bitsPerSample ~/ 8);
  int get _segmentBytes => _bytesPerSecond * segmentSeconds;

  /// Recorded audio so far, in seconds.
  double get recordedSeconds => totalBytes / _bytesPerSecond;

  void add(Uint8List pcm) {
    totalBytes += pcm.length;
    _buffer.add(pcm);
    while (_buffer.length >= _segmentBytes) {
      final all = _buffer.takeBytes();
      _emit(Uint8List.sublistView(all, 0, _segmentBytes));
      if (all.length > _segmentBytes) _buffer.add(Uint8List.sublistView(all, _segmentBytes));
    }
  }

  /// Emit whatever is buffered as the last (shorter) segment.
  void flush() {
    if (_buffer.isEmpty) return;
    _emit(_buffer.takeBytes());
  }

  void _emit(Uint8List pcm) {
    onSegment(nextIndex++, wavFromPcm(pcm, sampleRate: sampleRate, numChannels: numChannels, bitsPerSample: bitsPerSample));
  }
}

/// A canonical 44-byte-header PCM WAV file around [pcm].
Uint8List wavFromPcm(Uint8List pcm, {required int sampleRate, int numChannels = 1, int bitsPerSample = 16}) {
  final byteRate = sampleRate * numChannels * bitsPerSample ~/ 8;
  final blockAlign = numChannels * bitsPerSample ~/ 8;
  final header = ByteData(44)
    ..setUint32(0, 0x52494646) // "RIFF"
    ..setUint32(4, 36 + pcm.length, Endian.little)
    ..setUint32(8, 0x57415645) // "WAVE"
    ..setUint32(12, 0x666d7420) // "fmt "
    ..setUint32(16, 16, Endian.little) // PCM fmt chunk size
    ..setUint16(20, 1, Endian.little) // audio format: PCM
    ..setUint16(22, numChannels, Endian.little)
    ..setUint32(24, sampleRate, Endian.little)
    ..setUint32(28, byteRate, Endian.little)
    ..setUint16(32, blockAlign, Endian.little)
    ..setUint16(34, bitsPerSample, Endian.little)
    ..setUint32(36, 0x64617461) // "data"
    ..setUint32(40, pcm.length, Endian.little);
  return (BytesBuilder(copy: false)
        ..add(header.buffer.asUint8List())
        ..add(pcm))
      .takeBytes();
}
