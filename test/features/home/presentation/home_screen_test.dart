import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/core/auth/auth_state.dart';
import 'package:ally_mobile_flutter/core/push/push_notification_service.dart';
import 'package:ally_mobile_flutter/features/home/presentation/home_screen.dart';
import 'package:ally_mobile_flutter/features/notifications/data/notifications_repository.dart';

import '../../../support/prewarm_translations.dart';

class MockNotificationsRepository extends Mock implements NotificationsRepository {}

/// Real push registration needs Firebase, which isn't set up in the test
/// environment — see push_notification_service.dart's own doc comment for
/// why that's expected (it degrades gracefully in production too). Faking
/// it here keeps the test deterministic rather than relying on
/// `Firebase.initializeApp()`'s failure path.
class _FakePushNotificationService extends PushNotificationService {
  @override
  Future<void> initializeAndRegister(NotificationsRepository repository) async {}
}

/// Records calls instead of touching real secure storage (which isn't
/// available in the test environment either).
class _FakeAuthController extends AuthController {
  int logoutCalls = 0;

  @override
  AuthState build() => const AuthState(isAuthenticated: true);

  @override
  Future<void> logout() async {
    logoutCalls++;
    state = const AuthState(isAuthenticated: false);
  }
}

GoRouter _buildRouter() => GoRouter(
      initialLocation: '/home',
      routes: [
        GoRoute(path: '/home', builder: (context, state) => const HomeScreen()),
        for (final path in [
          '/courses',
          '/profile',
          '/notifications',
          '/simulations',
          '/leaderboard',
          '/achievements',
          '/bug-report',
          '/search',
          '/reviews',
          '/call-log',
          '/community',
          '/box-breathing',
          '/cases',
          '/scribe',
          '/roleplay',
        ])
          GoRoute(
            path: path,
            builder: (context, state) => Scaffold(body: Text('$path screen')),
          ),
      ],
    );

Future<void> _pumpHome(
  WidgetTester tester, {
  required _FakeAuthController authController,
  required MockNotificationsRepository notificationsRepository,
}) async {
  // HomeScreen's Column of 16 nav buttons overflows the default (much
  // shorter) test surface — it's a dev/phase-0 shell with no scroll view of
  // its own, so give the test surface enough height to actually lay it all
  // out instead of throwing a RenderFlex overflow.
  tester.view.physicalSize = const Size(800, 1800);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  await preWarmTranslations(tester);
  SharedPreferences.setMockInitialValues({});
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        authControllerProvider.overrideWith(() => authController),
        notificationsRepositoryProvider.overrideWithValue(notificationsRepository),
        pushNotificationServiceProvider.overrideWithValue(_FakePushNotificationService()),
      ],
      child: MaterialApp.router(routerConfig: _buildRouter()),
    ),
  );
  await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
  await tester.pumpAndSettle();
}

void main() {
  late _FakeAuthController authController;
  late MockNotificationsRepository notificationsRepository;

  setUp(() {
    authController = _FakeAuthController();
    notificationsRepository = MockNotificationsRepository();
  });

  testWidgets('renders every nav button', (tester) async {
    await _pumpHome(
      tester,
      authController: authController,
      notificationsRepository: notificationsRepository,
    );

    for (final label in [
      'Phase 2: Courses',
      'Phase 2: Profile',
      'Phase 2: Notifications',
      'Phase 3: Simulations',
      'Phase 4: Leaderboard',
      'Phase 4: Achievements',
      'Phase 4: Report a bug',
      'Phase 4: Search',
      'Phase 4: Reviews',
      'Phase 4: Call log',
      'Phase 4: Community',
      'Phase 4: Box breathing',
      'Phase 4: Cases',
      'Phase 1: Scribe recording',
      'Phase 1: Roleplay voice',
      'Logout',
    ]) {
      expect(find.text(label), findsOneWidget, reason: 'missing button: $label');
    }
  });

  testWidgets('tapping a nav button navigates to the expected route', (tester) async {
    await _pumpHome(
      tester,
      authController: authController,
      notificationsRepository: notificationsRepository,
    );

    await tester.tap(find.text('Phase 2: Courses'));
    await tester.pumpAndSettle();

    expect(find.text('/courses screen'), findsOneWidget);
  });

  testWidgets('tapping another nav button navigates there too', (tester) async {
    await _pumpHome(
      tester,
      authController: authController,
      notificationsRepository: notificationsRepository,
    );

    await tester.tap(find.text('Phase 4: Search'));
    await tester.pumpAndSettle();

    expect(find.text('/search screen'), findsOneWidget);
  });

  testWidgets('logout calls the auth controller', (tester) async {
    await _pumpHome(
      tester,
      authController: authController,
      notificationsRepository: notificationsRepository,
    );

    await tester.tap(find.text('Logout'));
    await tester.pumpAndSettle();

    expect(authController.logoutCalls, 1);
  });
}
