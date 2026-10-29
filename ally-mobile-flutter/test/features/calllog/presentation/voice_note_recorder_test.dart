import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:record/record.dart';

import 'package:ally_mobile_flutter/features/calllog/presentation/voice_note_recorder.dart';

import '../../../support/mock_path_provider.dart';
import '../../../support/mock_record_platform.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  installFakePathProvider();

  setUpAll(() {
    registerFallbackValue(const RecordConfig());
  });

  late MockRecordPlatform platform;
  late VoiceNoteRecorder recorder;

  setUp(() {
    platform = installMockRecordPlatform();
    // AudioRecorder.start() always wires up a state-change stream internally
    // (_initStateStream), regardless of whether a test cares about it.
    when(() => platform.onStateChanged(any())).thenAnswer((_) => const Stream.empty());
    recorder = VoiceNoteRecorder(recorder: AudioRecorder());
  });

  tearDown(() {
    recorder.dispose();
  });

  test('start() with permission granted begins recording', () async {
    when(() => platform.hasPermission(any(), request: any(named: 'request'))).thenAnswer((_) async => true);
    when(() => platform.start(any(), any(), path: any(named: 'path'))).thenAnswer((_) async {});

    await recorder.start();

    expect(recorder.status, VoiceRecorderStatus.recording);
    expect(recorder.error, isNull);
    expect(recorder.filePath, isNotNull);
    verify(() => platform.start(any(), any(), path: any(named: 'path'))).called(1);
  });

  test('start() with permission denied sets a permission error and stays idle', () async {
    when(() => platform.hasPermission(any(), request: any(named: 'request'))).thenAnswer((_) async => false);

    await recorder.start();

    expect(recorder.status, VoiceRecorderStatus.idle);
    expect(recorder.error, VoiceRecorderError.permission);
    verifyNever(() => platform.start(any(), any(), path: any(named: 'path')));
  });

  test('a platform exception on start sets a generic error and stays idle', () async {
    when(() => platform.hasPermission(any(), request: any(named: 'request'))).thenAnswer((_) async => true);
    when(() => platform.start(any(), any(), path: any(named: 'path'))).thenThrow(Exception('native failure'));

    await recorder.start();

    expect(recorder.status, VoiceRecorderStatus.idle);
    expect(recorder.error, VoiceRecorderError.generic);
  });

  test('pause then resume round-trips through the platform calls', () async {
    when(() => platform.hasPermission(any(), request: any(named: 'request'))).thenAnswer((_) async => true);
    when(() => platform.start(any(), any(), path: any(named: 'path'))).thenAnswer((_) async {});
    when(() => platform.pause(any())).thenAnswer((_) async {});
    when(() => platform.resume(any())).thenAnswer((_) async {});

    await recorder.start();
    await recorder.pause();
    expect(recorder.status, VoiceRecorderStatus.paused);

    await recorder.resume();
    expect(recorder.status, VoiceRecorderStatus.recording);

    verify(() => platform.pause(any())).called(1);
    verify(() => platform.resume(any())).called(1);
  });

  test('pause while not recording, or resume while not paused, is a no-op', () async {
    await recorder.pause();
    expect(recorder.status, VoiceRecorderStatus.idle);

    await recorder.resume();
    expect(recorder.status, VoiceRecorderStatus.idle);

    verifyNever(() => platform.pause(any()));
    verifyNever(() => platform.resume(any()));
  });

  test('stop() transitions recording to stopped and keeps the file path', () async {
    when(() => platform.hasPermission(any(), request: any(named: 'request'))).thenAnswer((_) async => true);
    when(() => platform.start(any(), any(), path: any(named: 'path'))).thenAnswer((_) async {});
    when(() => platform.stop(any())).thenAnswer((_) async => null);

    await recorder.start();
    final path = recorder.filePath;
    await recorder.stop();

    expect(recorder.status, VoiceRecorderStatus.stopped);
    expect(recorder.filePath, path);
  });

  test('reset() cancels an in-flight recording and returns to idle with no file', () async {
    when(() => platform.hasPermission(any(), request: any(named: 'request'))).thenAnswer((_) async => true);
    when(() => platform.start(any(), any(), path: any(named: 'path'))).thenAnswer((_) async {});
    when(() => platform.cancel(any())).thenAnswer((_) async {});

    await recorder.start();
    await recorder.reset();

    expect(recorder.status, VoiceRecorderStatus.idle);
    expect(recorder.filePath, isNull);
    expect(recorder.error, isNull);
    verify(() => platform.cancel(any())).called(1);
  });

  test('reset() from idle does not call cancel', () async {
    await recorder.reset();

    expect(recorder.status, VoiceRecorderStatus.idle);
    verifyNever(() => platform.cancel(any()));
  });

  test('notifyListeners fires on each state transition', () async {
    when(() => platform.hasPermission(any(), request: any(named: 'request'))).thenAnswer((_) async => true);
    when(() => platform.start(any(), any(), path: any(named: 'path'))).thenAnswer((_) async {});
    when(() => platform.stop(any())).thenAnswer((_) async => null);

    var notifications = 0;
    recorder.addListener(() => notifications++);

    await recorder.start();
    await recorder.stop();

    expect(notifications, greaterThanOrEqualTo(2));
  });

  testWidgets('auto-stops once the recording reaches the upload cap (RN MAX_RECORDING_BYTES)', (tester) async {
    when(() => platform.hasPermission(any(), request: any(named: 'request'))).thenAnswer((_) async => true);
    when(() => platform.start(any(), any(), path: any(named: 'path'))).thenAnswer((_) async {});
    when(() => platform.stop(any())).thenAnswer((_) async => null);
    expect(VoiceNoteRecorder.defaultMaxRecordingBytes, 24 * 1024 * 1024);

    // 3 seconds of 16kHz/16-bit mono.
    final capped = VoiceNoteRecorder(recorder: AudioRecorder(), maxRecordingBytes: 3 * VoiceNoteRecorder.bytesPerSecond);
    addTearDown(capped.dispose);
    await capped.start();
    expect(capped.status, VoiceRecorderStatus.recording);

    await tester.pump(const Duration(seconds: 2));
    expect(capped.status, VoiceRecorderStatus.recording);
    await tester.pump(const Duration(seconds: 1));
    await tester.pump();
    expect(capped.status, VoiceRecorderStatus.stopped);
    verify(() => platform.stop(any())).called(1);
  });
}
