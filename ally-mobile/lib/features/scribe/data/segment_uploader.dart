import 'dart:async';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'segmented_recording_repository.dart';

/// Uploads recording segments straight to S3, in the background, with
/// retries. Each segment is written to app storage first and deleted only once
/// S3 has it, so a dead network, a killed app or a deploy loses nothing:
/// leftovers are sent the next time the recording screen opens
/// ([resumePending]). [finish] waits for the queue, finalizes, and re-sends
/// whatever the server reports missing.
class SegmentUploader {
  SegmentUploader({
    required this.chatId,
    required this.repository,
    required this.directory,
    this.maxAttempts = 8,
    Duration Function(int attempt)? backoff,
    this.onSlow,
  }) : _backoff = backoff ?? _defaultBackoff;

  final int chatId;
  final SegmentedRecordingRepository repository;

  /// Where unsent segments are kept (`<app documents>/scribe_segments`).
  final Directory directory;
  final int maxAttempts;
  final Duration Function(int attempt) _backoff;

  /// Called once when uploads start lagging (to show "still saving").
  final void Function()? onSlow;
  bool _toldSlow = false;

  final Map<int, Future<bool>> _inFlight = {};

  static Duration _defaultBackoff(int attempt) => Duration(milliseconds: math.min(30000, 1000 * (1 << attempt)));

  static String fileName(int chatId, int index) => '${chatId}_$index.wav';

  File _file(int index) => File('${directory.path}/${fileName(chatId, index)}');

  int get pendingCount => _inFlight.length;

  Future<void> enqueue(int index, Uint8List wav) async {
    await directory.create(recursive: true);
    await _file(index).writeAsBytes(wav, flush: true);
    _inFlight[index] = _upload(index);
  }

  Future<bool> _upload(int index) async {
    for (var attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        final file = _file(index);
        if (!await file.exists()) {
          _inFlight.remove(index);
          return true;
        }
        final url = await repository.uploadUrl(chatId, index);
        await repository.putSegment(url, await file.readAsBytes());
        await file.delete();
        _inFlight.remove(index);
        return true;
      } catch (_) {
        if (attempt == 2 && !_toldSlow) {
          _toldSlow = true;
          onSlow?.call();
        }
        await Future<void>.delayed(_backoff(attempt));
      }
    }
    _inFlight.remove(index);
    return false; // still on disk; finish() or resumePending() retries it
  }

  /// Wait for the queue, then finalize. Segments the server lists as missing
  /// are re-sent from disk; after [rounds] tries the recording is finished
  /// with what arrived (flagged incomplete) rather than left open.
  Future<List<int>> finish({required int segmentCount, required double durationSeconds, int rounds = 3}) async {
    await Future.wait(_inFlight.values.toList());
    for (var round = 0; round < rounds; round++) {
      FinalizeResult result;
      try {
        result = await repository.finalize(chatId, segmentCount: segmentCount, durationSeconds: durationSeconds);
      } catch (_) {
        await Future<void>.delayed(_backoff(round));
        continue;
      }
      if (result.status != 'missing') return result.missing;
      for (final index in result.missing) {
        if (await _file(index).exists()) _inFlight[index] = _upload(index);
      }
      await Future.wait(_inFlight.values.toList());
    }
    final result = await repository.finalize(
      chatId,
      segmentCount: segmentCount,
      durationSeconds: durationSeconds,
      allowPartial: true,
    );
    return result.missing;
  }

  /// Send segments left on disk by an earlier session (a killed app, a dead
  /// network). Their recording is finished by the server meanwhile, or by
  /// the next finalize; a segment the server no longer accepts is dropped.
  static Future<void> resumePending({
    required SegmentedRecordingRepository repository,
    required Directory directory,
    int? exceptChatId,
  }) async {
    if (!await directory.exists()) return;
    final pattern = RegExp(r'^(\d+)_(\d+)\.wav$');
    await for (final entity in directory.list()) {
      if (entity is! File) continue;
      final match = pattern.firstMatch(entity.uri.pathSegments.last);
      if (match == null) continue;
      final chatId = int.parse(match.group(1)!);
      if (chatId == exceptChatId) continue;
      try {
        final url = await repository.uploadUrl(chatId, int.parse(match.group(2)!));
        await repository.putSegment(url, await entity.readAsBytes());
        await entity.delete();
      } on Object catch (error) {
        // A recording the server already finished refuses new segments:
        // nothing more to do with this one.
        if (error.toString().contains('409')) await entity.delete();
      }
    }
  }
}
