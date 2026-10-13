import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:permission_handler_platform_interface/permission_handler_platform_interface.dart';

import 'package:ally_mobile_flutter/core/realtime/socket_service.dart';
import 'package:ally_mobile_flutter/features/scribe/presentation/scribe_recording_screen.dart';

import '../../../support/fake_permission_platform.dart';
import '../../../support/mock_record_platform.dart';
import '../../../support/pump_app.dart';

class MockSocketService extends Mock implements SocketService {}

// See scribe_recording_screen_initial_state_test.dart (and, for the full
// explanation, roleplay_voice_screen_initial_state_test.dart) for why this
// screen's tests are one-`testWidgets`-per-file.
void main() {
  testWidgets(
    'denied mic permission shows an error and never touches the socket service',
    (tester) async {
      installMockRecordPlatform();
      PermissionHandlerPlatform.instance = FakePermissionHandlerPlatform({
        Permission.microphone: PermissionStatus.denied,
      });
      final socketService = MockSocketService();

      await pumpApp(
        tester,
        const ScribeRecordingScreen(userId: 'user-1'),
        overrides: [socketServiceProvider.overrideWithValue(socketService)],
      );

      await tester.tap(find.text('Start recording'));
      await tester.pumpAndSettle();

      expect(find.text('Microphone permission required'), findsOneWidget);
      expect(find.text('Not recording'), findsOneWidget);
      verifyZeroInteractions(socketService);
    },
  );
}

// NOTE on scope: `installMockRecordPlatform()` only stubs the two calls
// (`create`/`dispose`) that fire just from pumping/unmounting this screen at
// all (see mock_record_platform.dart) — it deliberately doesn't stub
// `startStream`, so the granted-permission "start recording" path remains
// out of reach here. That path additionally needs, in order:
// `Permission.notification.request()` (the same fakeable permission_handler
// seam as mic — not separately tested, since it's the identical branch
// shape with no distinct logic), `ForegroundRecordingService.start()` (a
// static call, not provider-based — already covered on its own in
// foreground_recording_service_test.dart via its own platform-interface
// fake), and then `AudioRecorder.startStream(...)` itself, which would mean
// additionally stubbing record's streaming surface and synthesizing a fake
// PCM audio byte stream just to reach one button's happy path. That's
// exactly the kind of fragile, native-SDK-mocking busywork this batch is
// told to avoid, for a path whose real value (does audio keep streaming
// while backgrounded) no Dart-VM unit test can observe anyway. The
// mic-permission-denied test above is the one branch in this screen that's
// both real logic and reachable without any of that, since
// `_startRecording()` returns before `startStream` is ever touched.
