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
  testWidgets('denied mic permission shows an error and never touches the socket service', (
    tester,
  ) async {
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

    expect(find.text('Microphone permission required'), findsOneWidget);
    verifyZeroInteractions(socketService);
  });
}
