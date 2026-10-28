import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'package:ally_mobile_flutter/core/auth/auth_state.dart';
import 'package:ally_mobile_flutter/features/suspended/presentation/suspended_account_screen.dart';

import '../../../support/pump_app.dart';
import '../../../support/prewarm_translations.dart';
import '../../../support/pump_router_app.dart';

/// Records the logout call instead of touching real secure storage (not
/// available in the test environment).
class _FakeAuthController extends AuthController {
  int logoutCalls = 0;
  bool startSignedOut = false;

  @override
  AuthState build() => AuthState(isAuthenticated: !startSignedOut);

  @override
  Future<void> logout() async {
    logoutCalls++;
    state = const AuthState(isAuthenticated: false);
  }
}

void main() {
  late _FakeAuthController authController;

  setUp(() {
    authController = _FakeAuthController();
  });

  testWidgets('renders the suspended message', (tester) async {
    await preWarmTranslations(tester);
    await pumpApp(
      tester,
      const SuspendedAccountScreen(),
      overrides: [authControllerProvider.overrideWith(() => authController)],
    );

    expect(find.text('Account Suspended'), findsOneWidget);
    expect(
      find.text(
        // RN joins the two lines with no space ("youradministrator").
        'Your account has been suspended. Contact your '
        'administrator for assistance',
      ),
      findsOneWidget,
    );
    expect(find.text('Go to login'), findsOneWidget);
  });

  testWidgets('the button logs out', (tester) async {
    await preWarmTranslations(tester);
    await pumpApp(
      tester,
      const SuspendedAccountScreen(),
      overrides: [authControllerProvider.overrideWith(() => authController)],
    );

    await tester.tap(find.text('Go to login'));
    await tester.pumpAndSettle();

    expect(authController.logoutCalls, 1);
  });

  testWidgets('from the signed-out login flow, the button still returns to /login '
      '(logout alone changes no auth state there)', (tester) async {
    final signedOut = _FakeAuthController()..startSignedOut = true;
    await pumpRouterApp(
      tester,
      initialLocation: '/suspended',
      routes: [
        GoRoute(path: '/login', builder: (context, state) => const Text('Login Screen')),
        GoRoute(path: '/suspended', builder: (context, state) => const SuspendedAccountScreen()),
      ],
      overrides: [authControllerProvider.overrideWith(() => signedOut)],
    );

    expect(find.byType(SvgPicture), findsOneWidget);
    await tester.tap(find.text('Go to login'));
    await tester.pumpAndSettle();

    expect(find.text('Login Screen'), findsOneWidget);
    expect(signedOut.logoutCalls, 1);
  });
}
