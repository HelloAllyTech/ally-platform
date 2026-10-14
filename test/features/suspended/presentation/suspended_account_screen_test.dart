import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/auth/auth_state.dart';
import 'package:ally_mobile_flutter/features/suspended/presentation/suspended_account_screen.dart';

import '../../../support/pump_app.dart';
import '../../../support/prewarm_translations.dart';

/// Records the logout call instead of touching real secure storage (not
/// available in the test environment).
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
        'Your account has been suspended. Contact your'
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
}
