import 'dart:io';
import 'dart:typed_data';

import 'package:ally_mobile_flutter/features/scribe/data/segment_uploader.dart';
import 'package:ally_mobile_flutter/features/scribe/data/segmented_recording_repository.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

class FakeRepo extends SegmentedRecordingRepository {
  FakeRepo() : super(Dio());

  final List<int> uploaded = [];
  int failPuts = 0;
  final List<FinalizeResult Function(bool allowPartial)> finalizeReplies = [];
  final List<bool> finalizeCalls = [];

  @override
  Future<String> uploadUrl(int chatId, int index) async => 'https://s3/$chatId/$index';

  @override
  Future<void> putSegment(String url, List<int> bytes) async {
    if (failPuts > 0) {
      failPuts--;
      throw Exception('network');
    }
    uploaded.add(int.parse(url.split('/').last));
  }

  @override
  Future<FinalizeResult> finalize(int chatId, {required int segmentCount, double? durationSeconds, bool allowPartial = false}) async {
    finalizeCalls.add(allowPartial);
    if (finalizeReplies.isEmpty) return const FinalizeResult(status: 'finalized', missing: []);
    return finalizeReplies.removeAt(0)(allowPartial);
  }
}

void main() {
  late Directory dir;
  late FakeRepo repo;

  setUp(() async {
    dir = await Directory.systemTemp.createTemp('segments');
    repo = FakeRepo();
  });
  tearDown(() => dir.delete(recursive: true));

  SegmentUploader make() => SegmentUploader(chatId: 7, repository: repo, directory: dir, backoff: (_) => Duration.zero);
  File file(int i) => File('${dir.path}/${SegmentUploader.fileName(7, i)}');

  test('keeps each segment on disk until S3 has it', () async {
    final up = make();
    await up.enqueue(0, Uint8List(10));
    await up.enqueue(1, Uint8List(10));
    final missing = await up.finish(segmentCount: 2, durationSeconds: 60);
    expect(missing, isEmpty);
    expect(repo.uploaded..sort(), [0, 1]);
    expect(file(0).existsSync() || file(1).existsSync(), isFalse);
  });

  test('retries a failed upload', () async {
    repo.failPuts = 2;
    final up = make();
    await up.enqueue(0, Uint8List(10));
    await up.finish(segmentCount: 1, durationSeconds: 30);
    expect(repo.uploaded, [0]);
  });

  test('re-sends what the server reports missing, then finalizes', () async {
    // Segment 1 is on disk but never reached S3 (the app was killed).
    await file(1).writeAsBytes([1, 2, 3]);
    repo.finalizeReplies.add((_) => const FinalizeResult(status: 'missing', missing: [1]));
    final up = make();
    final missing = await up.finish(segmentCount: 2, durationSeconds: 60);
    expect(missing, isEmpty);
    expect(repo.uploaded, [1]);
    expect(repo.finalizeCalls, [false, false]);
  });

  test('finishes with what arrived, flagged partial, when a segment never comes', () async {
    for (var i = 0; i < 3; i++) {
      repo.finalizeReplies.add((_) => const FinalizeResult(status: 'missing', missing: [3]));
    }
    repo.finalizeReplies.add((partial) => FinalizeResult(status: 'finalized', missing: partial ? const [3] : const []));
    final missing = await make().finish(segmentCount: 4, durationSeconds: 120);
    expect(missing, [3]);
    expect(repo.finalizeCalls.last, isTrue);
  });

  test('sends segments an earlier session left on disk, except the current chat', () async {
    await File('${dir.path}/${SegmentUploader.fileName(5, 0)}').writeAsBytes([1]);
    await File('${dir.path}/${SegmentUploader.fileName(7, 4)}').writeAsBytes([1]);
    await SegmentUploader.resumePending(repository: repo, directory: dir, exceptChatId: 7);
    expect(repo.uploaded, [0]);
    expect(File('${dir.path}/${SegmentUploader.fileName(5, 0)}').existsSync(), isFalse);
    expect(file(4).existsSync(), isTrue);
  });
}
