import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:flutter_foreground_task/flutter_foreground_task_platform_interface.dart';

/// Records every `startService`/`stopService` call and tracks a simple
/// "is the service running" flag, backing `FlutterForegroundTaskPlatform`
/// — flutter_foreground_task's own swappable platform-interface seam (same
/// mechanism its real Android/iOS implementations register through), which
/// is what makes `ForegroundRecordingService`'s lifecycle-guard logic
/// testable at all without a real Android foreground service. Shared by
/// `foreground_recording_service_test.dart` and any screen test (e.g.
/// `scribe_recording_screen_*_test.dart`) that merely needs
/// `ForegroundRecordingService.start()`/`.stop()` to succeed quietly.
class FakeForegroundTaskPlatform extends FlutterForegroundTaskPlatform {
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
