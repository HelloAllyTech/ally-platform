import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/auth/auth_state.dart';
import 'package:ally_mobile_flutter/core/config/app_config.dart';
import 'package:ally_mobile_flutter/core/widgets/app_button.dart';
import 'package:ally_mobile_flutter/features/auth/data/auth_repository.dart';
import 'package:ally_mobile_flutter/features/auth/presentation/login_screen.dart';

import '../../../support/pump_app.dart';
import '../../../support/prewarm_translations.dart';

class MockAuthRepository extends Mock implements AuthRepository {}

/// Records `signIn`/`logout` calls instead of touching real secure storage
/// (not available in the test environment) — same pattern used by the
/// other screens that call into `authControllerProvider`.
class _FakeAuthController extends AuthController {
  int signInCalls = 0;
  String? lastAccessToken;
  String? lastRefreshToken;

  @override
  AuthState build() => AuthState.unknown;

  @override
  Future<void> signIn({required String accessToken, required String refreshToken}) async {
    signInCalls++;
    lastAccessToken = accessToken;
    lastRefreshToken = refreshToken;
    state = const AuthState(isAuthenticated: true);
  }

  @override
  Future<void> logout() async {
    state = const AuthState(isAuthenticated: false);
  }
}

void main() {
  late MockAuthRepository authRepository;
  late _FakeAuthController authController;

  setUp(() {
    authRepository = MockAuthRepository();
    authController = _FakeAuthController();
  });

  Future<void> pumpLogin(WidgetTester tester) async {
    await preWarmTranslations(tester);
    await pumpApp(
      tester,
      const LoginScreen(),
      overrides: [
        authRepositoryProvider.overrideWithValue(authRepository),
        authControllerProvider.overrideWith(() => authController),
      ],
    );
  }

  group('email step', () {
    testWidgets('shows a validation error and does not call generateOtp when empty', (tester) async {
      await pumpLogin(tester);

      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();

      expect(find.text('Please enter a valid email address'), findsOneWidget);
      verifyNever(() => authRepository.generateOtp(any()));
    });

    testWidgets('calls generateOtp and advances to the OTP step on success', (tester) async {
      when(() => authRepository.generateOtp('learner@example.com')).thenAnswer((_) async {});

      await pumpLogin(tester);

      await tester.enterText(find.byType(TextField), 'learner@example.com');
      await tester.pump();
      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();

      verify(() => authRepository.generateOtp('learner@example.com')).called(1);
      expect(find.text('Enter the security code sent to learner@example.com'), findsOneWidget);
    });

    testWidgets('shows an error when generateOtp fails', (tester) async {
      when(() => authRepository.generateOtp(any())).thenThrow(Exception('network down'));

      await pumpLogin(tester);

      await tester.enterText(find.byType(TextField), 'learner@example.com');
      await tester.pump();
      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();

      expect(
        find.textContaining('Failed to generate OTP. Please try again.'),
        findsOneWidget,
      );
    });

    testWidgets('disables the Google button when googleWebClientId is empty', (tester) async {
      await pumpLogin(tester);

      // The real default (no --dart-define passed in tests): matches
      // login_screen.dart's own gating — `_googleInitFuture` is only set
      // when this is non-empty, and the button's `onPressed` is null
      // whenever that future is null.
      expect(AppConfig.googleWebClientId, isEmpty);

      final button = tester.widget<OutlinedButton>(
        find.ancestor(of: find.text('Continue with Google'), matching: find.byType(OutlinedButton)),
      );
      expect(button.onPressed, isNull);
    });

    testWidgets('only shows the Apple button on iOS', (tester) async {
      await pumpLogin(tester);

      // This test process runs as the host OS (not an iOS simulator), so
      // `Platform.isIOS` is false here — same condition login_screen.dart
      // itself gates the button on — and the button should be absent.
      expect(Platform.isIOS, isFalse);
      expect(find.text('Continue with Apple'), findsNothing);
    });
  });

  group('otp step', () {
    Future<void> advanceToOtpStep(WidgetTester tester) async {
      when(() => authRepository.generateOtp('learner@example.com')).thenAnswer((_) async {});
      await pumpLogin(tester);
      await tester.enterText(find.byType(TextField), 'learner@example.com');
      await tester.pump();
      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();
    }

    testWidgets('shows a validation error and does not call verifyOtp when empty', (tester) async {
      await advanceToOtpStep(tester);

      await tester.tap(find.text('Verify'));
      await tester.pumpAndSettle();

      expect(find.text('Enter the code.'), findsOneWidget);
      verifyNever(() => authRepository.verifyOtp(email: any(named: 'email'), otp: any(named: 'otp')));
    });

    testWidgets(
      'calls verifyOtp, shows the terms modal, and only signs in once agreed',
      (tester) async {
        when(() => authRepository.verifyOtp(email: 'learner@example.com', otp: '123456'))
            .thenAnswer((_) async => ('access-tok', 'refresh-tok'));

        await advanceToOtpStep(tester);
        await tester.enterText(find.byType(TextField).last, '123456');
        await tester.pump();
        await tester.tap(find.text('Verify'));
        // Not pumpAndSettle: the Verify button's spinner animates
        // indefinitely while `TermsAndAgreementModal.show` is awaiting the
        // learner's input, which `pumpAndSettle` would time out on.
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));

        verify(() => authRepository.verifyOtp(email: 'learner@example.com', otp: '123456')).called(1);
        expect(authController.signInCalls, 0, reason: 'tokens are held until the terms are agreed to');
        expect(find.text('Terms and agreement'), findsOneWidget);
        expect(find.byKey(const Key('scroll-to-bottom-button')), findsOneWidget);

        // Scroll the terms document to the bottom to reveal the
        // checkbox/Agree button. Not pumpAndSettle here either — same
        // indefinite-spinner reason as above, still true until Agree is
        // tapped.
        await tester.fling(find.byType(SingleChildScrollView), const Offset(0, -5000), 8000);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 350));

        expect(find.byKey(const Key('scroll-to-bottom-button')), findsNothing);
        final agreeButtonBefore = tester.widget<AppButton>(find.byType(AppButton).last);
        expect(agreeButtonBefore.isDisabled, isTrue, reason: 'unchecked');

        await tester.tap(find.byKey(const Key('agree-checkbox-container')));
        await tester.pump();

        final agreeButtonAfter = tester.widget<AppButton>(find.byType(AppButton).last);
        expect(agreeButtonAfter.isDisabled, isFalse);

        await tester.tap(find.byType(AppButton).last);
        await tester.pumpAndSettle();

        expect(authController.signInCalls, 1);
        expect(authController.lastAccessToken, 'access-tok');
        expect(authController.lastRefreshToken, 'refresh-tok');
      },
    );

    testWidgets('shows an error when verifyOtp fails', (tester) async {
      when(() => authRepository.verifyOtp(email: any(named: 'email'), otp: any(named: 'otp')))
          .thenThrow(Exception('bad code'));

      await advanceToOtpStep(tester);
      await tester.enterText(find.byType(TextField).last, '000000');
      await tester.pump();
      await tester.tap(find.text('Verify'));
      await tester.pumpAndSettle();

      expect(
        find.textContaining('Failed to verify OTP. Please try again.'),
        findsOneWidget,
      );
      expect(authController.signInCalls, 0);
    });

    testWidgets("'use a different email' goes back to the email step", (tester) async {
      await advanceToOtpStep(tester);

      await tester.tap(find.text('Use a different email'));
      await tester.pumpAndSettle();

      expect(find.text('Email'), findsOneWidget);
      expect(find.text('Next'), findsOneWidget);
      // The previously entered email is preserved in the controller, same
      // as the raw _emailController state login_screen.dart keeps around.
      expect(find.text('learner@example.com'), findsOneWidget);
    });
  });
}
