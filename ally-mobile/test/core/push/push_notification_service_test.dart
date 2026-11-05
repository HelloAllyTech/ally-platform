import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/push/push_notification_service.dart';
import 'package:ally_mobile_flutter/features/notifications/data/notifications_repository.dart';

class MockNotificationsRepository extends Mock implements NotificationsRepository {}

// The one piece of real, documented behavior in this file is the graceful-
// degradation contract spelled out in its own doc comment: a missing/
// misconfigured Firebase project (no google-services.json /
// GoogleService-Info.plist registered yet — true today) must degrade to
// "push notifications don't work yet" instead of crashing app startup.
// That's exactly what this test exercises for real: in the plain Flutter
// test environment there is no Firebase platform-channel handler
// registered at all, so `Firebase.initializeApp()` fails the same way it
// does on a real device without those config files — no mocking required
// to hit this branch, it's the natural behavior of the test environment.
void main() {
  late MockNotificationsRepository repository;
  late PushNotificationService service;

  setUp(() {
    repository = MockNotificationsRepository();
    service = PushNotificationService();
  });

  test('swallows a Firebase.initializeApp() failure instead of throwing', () async {
    // Never actually navigated to — `initializeAndRegister` returns from the
    // `Firebase.initializeApp()` catch block before touching `router` at all
    // in this environment (no Firebase platform-channel handler registered).
    final router = GoRouter(routes: [GoRoute(path: '/', builder: (_, _) => const SizedBox())]);

    await expectLater(service.initializeAndRegister(repository, router), completes);

    verifyZeroInteractions(repository);
  });
}

// NOTE on scope: the happy path this service exists for — Firebase
// initializes, `messaging.requestPermission()`/`getToken()` succeed, the
// token is registered via the repository, and `onTokenRefresh` re-registers
// on later refreshes — all requires Firebase's own test-platform mocking
// (`setupFirebaseCoreMocks()` from firebase_core_platform_interface, plus a
// fake `FirebaseMessagingPlatform` implementing its full ~10-member
// surface), none of which is set up anywhere in this repo today. Standing
// that up from scratch here would be the fragile, SDK-surface-mocking
// busywork this batch is explicitly told to avoid, for a path whose only
// non-Firebase logic (the `_platform` getter's IOS/ANDROID string, and the
// inner try/catch) is a one-line ternary and a second instance of the exact
// same swallow-and-return pattern already verified above. Flagging this as
// a documented gap rather than forcing a heavyweight fake for marginal
// additional coverage.
