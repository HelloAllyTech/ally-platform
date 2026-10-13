import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:flutter_foreground_task/flutter_foreground_task_platform_interface.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/realtime/foreground_recording_service.dart';

/// Records every `startService`/`stopService` call and tracks a simple
/// "is the service running" flag, backing `FlutterForegroundTaskPlatform`
/// — flutter_foreground_task's own swappable platform-interface seam
/// (same mechanism its real Android/iOS implementations register through),
/// which is what makes this file's service-lifecycle guard logic testable
/// at all without a real Android foreground service.
class _FakeForegroundTaskPlatform extends FlutterForegroundTaskPlatform {
  bool running = false;
  final List<({String title, String text, List<ForegroundServiceTypes>? types})> startCalls = [];
  int stopCallCount = 0;

  @override
  Future<bool> get isRunningService async => running;

  @override
  Future<void> startService({
    required AndroidNotificationOptions androidNotificationOptions,
    required IOSNotificationOptions iosNotificationOptions,
    required ForegroundTaskOptions foregroundTaskOptions,
    int? serviceId,
    List<ForegroundServiceTypes>? serviceTypes,
    required String notificationTitle,
    required String notificationText,
    NotificationIcon? notificationIcon,
    List<NotificationButton>? notificationButtons,
    String? notificationInitialRoute,
    Function? callback,
  }) async {
    startCalls.add((title: notificationTitle, text: notificationText, types: serviceTypes));
    running = true;
  }

  @override
  Future<void> stopService() async {
    stopCallCount++;
    running = false;
  }
}

// This file is the one genuinely Android-specific candidate in the batch
// that turned out to have real, directly testable logic: `start()`/`stop()`
// both guard on `FlutterForegroundTask.isRunningService` before calling
// through to the platform (the idempotent "don't start twice" / "don't stop
// what isn't running" behavior) — exactly the kind of service-lifecycle
// state tracking the task brief calls out. The persistent-notification
// *content* (channel id/name/description, priority) is also exercised here
// via the real `FlutterForegroundTask.init(...)` call, just not asserted on
// beyond what's captured through `startService`'s own args, since the
// init() options aren't otherwise observable.
//
// Not covered: whether Android actually keeps the microphone alive because
// of this — that's the real native behavior this class exists to drive,
// and no test running on the Dart VM can observe it.
void main() {
  late _FakeForegroundTaskPlatform fakePlatform;

  setUp(() {
    fakePlatform = _FakeForegroundTaskPlatform();
    FlutterForegroundTaskPlatform.instance = fakePlatform;
  });

  group('ForegroundRecordingService.start()', () {
    test('starts the service with the given notification text when not already running', () async {
      await ForegroundRecordingService.start(
        notificationTitle: 'Recording session',
        notificationText: 'Ally is recording this session.',
      );

      expect(fakePlatform.startCalls, hasLength(1));
      final call = fakePlatform.startCalls.single;
      expect(call.title, 'Recording session');
      expect(call.text, 'Ally is recording this session.');
      expect(call.types, contains(ForegroundServiceTypes.microphone));
      expect(fakePlatform.running, isTrue);
    });

    test('does nothing when the service is already running', () async {
      fakePlatform.running = true;

      await ForegroundRecordingService.start(
        notificationTitle: 'Recording session',
        notificationText: 'Ally is recording this session.',
      );

      expect(fakePlatform.startCalls, isEmpty);
    });
  });

  group('ForegroundRecordingService.stop()', () {
    test('does nothing when the service is not running', () async {
      await ForegroundRecordingService.stop();

      expect(fakePlatform.stopCallCount, 0);
    });

    test('stops the service when it is running', () async {
      fakePlatform.running = true;

      await ForegroundRecordingService.stop();

      expect(fakePlatform.stopCallCount, 1);
      expect(fakePlatform.running, isFalse);
    });
  });
}
