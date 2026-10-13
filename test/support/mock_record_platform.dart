import 'package:mocktail/mocktail.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';
import 'package:record_platform_interface/record_platform_interface.dart';

/// Mock for `record`'s platform-interface seam, using the exact pattern
/// `plugin_platform_interface` itself documents as the sanctioned way to
/// satisfy a `PlatformInterface`'s `verifyToken` check from a test double:
/// `extends Mock with MockPlatformInterfaceMixin implements ...`.
///
/// `AudioRecorder`'s constructor calls `RecordPlatform.instance.create(...)`
/// eagerly — not lazily on "start recording" — and its own `dispose()`
/// always calls `RecordPlatform.instance.dispose(...)`. Since
/// `ScribeRecordingScreen` holds a hardcoded
/// `final AudioRecorder _recorder = AudioRecorder();` field, both calls
/// fire just from pumping/unmounting the screen, even in tests that never
/// touch "start recording" — without this, every such test throws a real
/// `MissingPluginException` on the `com.llfbandit.record/messages` channel
/// (found the hard way: see scribe_recording_screen_initial_state_test.dart).
class MockRecordPlatform extends Mock
    with MockPlatformInterfaceMixin
    implements RecordPlatform {}

/// Installs a [MockRecordPlatform] with `create`/`dispose` stubbed to
/// succeed (the only two calls any pump/unmount of ScribeRecordingScreen
/// makes), and returns it in case a test wants to stub or verify more.
MockRecordPlatform installMockRecordPlatform() {
  final platform = MockRecordPlatform();
  when(() => platform.create(any())).thenAnswer((_) async {});
  when(() => platform.dispose(any())).thenAnswer((_) async {});
  RecordPlatform.instance = platform;
  return platform;
}
