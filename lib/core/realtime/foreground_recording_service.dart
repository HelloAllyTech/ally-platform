import 'package:flutter_foreground_task/flutter_foreground_task.dart';

/// The actual fix this whole migration exists to prove: ally-mobile (React
/// Native) declares no Android foreground service at all (confirmed by
/// checking its AndroidManifest.xml directly), so on Android 14+ the OS can
/// silently stop microphone capture the moment the app backgrounds — no
/// amount of JS-side socket/reconnection logic can work around that, since
/// the audio stream itself goes dead at the OS level.
///
/// This wraps flutter_foreground_task's service, which backs the
/// `foregroundServiceType="microphone"` declaration in
/// AndroidManifest.xml — call [start] before beginning mic capture and
/// [stop] when the recording session ends. The persistent notification is
/// an Android requirement for any foreground service, not optional chrome.
class ForegroundRecordingService {
  ForegroundRecordingService._();

  static bool _initialized = false;

  static void _ensureInitialized() {
    if (_initialized) return;
    FlutterForegroundTask.init(
      androidNotificationOptions: AndroidNotificationOptions(
        channelId: 'ally_recording_channel',
        channelName: 'Session recording',
        channelDescription:
            'Shown while Ally is recording or actively connected to a live '
            'session, so Android keeps the microphone alive in the '
            'background.',
        priority: NotificationPriority.LOW,
      ),
      iosNotificationOptions: const IOSNotificationOptions(),
      foregroundTaskOptions: ForegroundTaskOptions(
        eventAction: ForegroundTaskEventAction.nothing(),
        autoRunOnBoot: false,
        allowWakeLock: true,
      ),
    );
    _initialized = true;
  }

  static Future<void> start({
    required String notificationTitle,
    required String notificationText,
  }) async {
    _ensureInitialized();
    final isRunning = await FlutterForegroundTask.isRunningService;
    if (isRunning) return;
    await FlutterForegroundTask.startService(
      serviceId: 1,
      serviceTypes: [ForegroundServiceTypes.microphone],
      notificationTitle: notificationTitle,
      notificationText: notificationText,
    );
  }

  static Future<void> stop() async {
    final isRunning = await FlutterForegroundTask.isRunningService;
    if (!isRunning) return;
    await FlutterForegroundTask.stopService();
  }
}
