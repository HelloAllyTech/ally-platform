import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:lottie/lottie.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/auth/auth_state.dart';
import 'package:ally_mobile_flutter/core/config/app_config.dart';
import 'package:ally_mobile_flutter/core/widgets/app_button.dart';
import 'package:ally_mobile_flutter/features/auth/data/auth_repository.dart';
import 'package:ally_mobile_flutter/features/auth/presentation/login_screen.dart';

import '../../../support/pump_app.dart';
import '../../../support/pump_router_app.dart';
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
    testWidgets(
      'disables Next for an empty or invalid-shaped email, enables it once valid '
      '(RN\'s isValidEmail gate — Flutter previously had no gate at all, so "abc" '
      'could reach the backend unvalidated)',
      (tester) async {
        await pumpLogin(tester);

        var nextButton = tester.widget<AppButton>(find.widgetWithText(AppButton, 'Next'));
        expect(nextButton.isDisabled, isTrue, reason: 'empty');

        await tester.enterText(find.byType(TextField), 'not-an-email');
        await tester.pump();
        nextButton = tester.widget<AppButton>(find.widgetWithText(AppButton, 'Next'));
        expect(nextButton.isDisabled, isTrue, reason: 'no @ or domain');

        await tester.enterText(find.byType(TextField), 'learner@example.com');
        await tester.pump();
        nextButton = tester.widget<AppButton>(find.widgetWithText(AppButton, 'Next'));
        expect(nextButton.isDisabled, isFalse);

        verifyNever(() => authRepository.generateOtp(any()));
      },
    );

    testWidgets('calls generateOtp and advances to the OTP step on success', (tester) async {
      when(() => authRepository.generateOtp('learner@example.com')).thenAnswer((_) async => null);

      await pumpLogin(tester);

      await tester.enterText(find.byType(TextField), 'learner@example.com');
      await tester.pump();
      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();

      verify(() => authRepository.generateOtp('learner@example.com')).called(1);
      // Two separately-styled spans in one `Text.rich` (RN's headerText +
      // emailText) — rendered on their own line, not one flat sentence.
      expect(find.text('Enter the security code sent to\nlearner@example.com'), findsOneWidget);
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

    testWidgets(
      'shows the real two-line greeting ("Hey," then "Welcome to Ally"), '
      'which switches to a single OTP-step line once advanced',
      (tester) async {
        when(() => authRepository.generateOtp(any())).thenAnswer((_) async => null);

        await pumpLogin(tester);

        expect(find.text('Hey,'), findsOneWidget);
        expect(find.text('Welcome to Ally'), findsOneWidget);

        await tester.enterText(find.byType(TextField), 'learner@example.com');
        await tester.pump();
        await tester.tap(find.text('Next'));
        await tester.pumpAndSettle();

        expect(find.text('Hey,'), findsNothing);
        expect(find.text('Welcome to Ally'), findsNothing);
        expect(find.text('Verify your email address'), findsOneWidget);
      },
    );

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

    testWidgets(
      'shows the subtitle, the real Google logo (not a generic icon), and the '
      'Terms/Privacy footer with its real double period',
      (tester) async {
        await pumpLogin(tester);

        expect(find.text('Enter your email address to continue'), findsOneWidget);

        final googleIcon = tester.widget<SvgPicture>(
          find.descendant(
            of: find.ancestor(
              of: find.text('Continue with Google'),
              matching: find.byType(OutlinedButton),
            ),
            matching: find.byType(SvgPicture),
          ),
        );
        expect(
          (googleIcon.bytesLoader as SvgAssetLoader).assetName,
          'assets/icons/google.svg',
        );

        expect(
          find.textContaining("By proceeding, i agree to Ally's"),
          findsOneWidget,
        );
        expect(find.textContaining('Privacy Policy..'), findsOneWidget);
      },
    );

    testWidgets('shows the real splash Lottie animation above the greeting', (tester) async {
      await pumpLogin(tester);

      final builder = tester.widget<LottieBuilder>(find.byType(LottieBuilder));
      expect((builder.lottie as AssetLottie).assetName, 'assets/animations/splashAnimation.json');
    });
  });

  group('otp step', () {
    Future<void> advanceToOtpStep(WidgetTester tester) async {
      when(() => authRepository.generateOtp('learner@example.com')).thenAnswer((_) async => null);
      await pumpLogin(tester);
      await tester.enterText(find.byType(TextField), 'learner@example.com');
      await tester.pump();
      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();
    }

    /// The OTP step renders exactly 4 boxed digit `TextField`s (in order) —
    /// enters one digit into each.
    Future<void> enterOtp(WidgetTester tester, String digits) async {
      final fields = find.byType(TextField);
      for (var i = 0; i < digits.length; i++) {
        await tester.enterText(fields.at(i), digits[i]);
      }
      await tester.pump();
    }

    testWidgets('hides the splash Lottie animation once advanced to the OTP step', (tester) async {
      await advanceToOtpStep(tester);

      expect(find.byType(LottieBuilder), findsNothing);
    });

    testWidgets('disables Verify until all 4 digits are entered, then enables it', (tester) async {
      await advanceToOtpStep(tester);

      var verifyButton = tester.widget<AppButton>(find.widgetWithText(AppButton, 'Verify'));
      expect(verifyButton.isDisabled, isTrue);

      await enterOtp(tester, '123');
      verifyButton = tester.widget<AppButton>(find.widgetWithText(AppButton, 'Verify'));
      expect(verifyButton.isDisabled, isTrue, reason: 'only 3 of 4 boxes filled');

      await enterOtp(tester, '1234');
      verifyButton = tester.widget<AppButton>(find.widgetWithText(AppButton, 'Verify'));
      expect(verifyButton.isDisabled, isFalse);

      verifyNever(() => authRepository.verifyOtp(email: any(named: 'email'), otp: any(named: 'otp')));
    });

    testWidgets(
      'calls verifyOtp, shows the terms modal, and only signs in once agreed',
      (tester) async {
        when(() => authRepository.verifyOtp(email: 'learner@example.com', otp: '1234'))
            .thenAnswer((_) async => ('access-tok', 'refresh-tok'));

        await advanceToOtpStep(tester);
        await enterOtp(tester, '1234');
        await tester.tap(find.text('Verify'));
        // Not pumpAndSettle: the Verify button's spinner animates
        // indefinitely while `TermsAndAgreementModal.show` is awaiting the
        // learner's input, which `pumpAndSettle` would time out on.
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));

        verify(() => authRepository.verifyOtp(email: 'learner@example.com', otp: '1234')).called(1);
        expect(authController.signInCalls, 0, reason: 'tokens are held until the terms are agreed to');
        expect(find.text('Terms and agreement'), findsOneWidget);
        expect(find.byKey(const Key('scroll-to-bottom-button')), findsOneWidget);

        // Scroll the terms document to the bottom to reveal the
        // checkbox/Agree button. Not pumpAndSettle here either — same
        // indefinite-spinner reason as above, still true until Agree is
        // tapped.
        // `.last`: the terms modal's own scroll view, not LoginScreen's
        // (now that it also has one, wrapping the email/OTP form so the
        // added subtitle/footer text can't overflow a short screen).
        await tester.fling(
          find.byType(SingleChildScrollView).last,
          const Offset(0, -5000),
          8000,
        );
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
      await enterOtp(tester, '0000');
      await tester.tap(find.text('Verify'));
      await tester.pumpAndSettle();

      expect(
        find.textContaining('Failed to verify OTP. Please try again.'),
        findsOneWidget,
      );
      expect(authController.signInCalls, 0);
    });

    testWidgets(
      'a 403 USER_SUSPENDED response routes to /suspended instead of showing a generic error',
      (tester) async {
        when(() => authRepository.verifyOtp(email: any(named: 'email'), otp: any(named: 'otp')))
            .thenThrow(
          DioException(
            requestOptions: RequestOptions(path: '/v1/auth/verify-otp'),
            response: Response(
              requestOptions: RequestOptions(path: '/v1/auth/verify-otp'),
              statusCode: 403,
              data: {'error': 'USER_SUSPENDED', 'message': 'User suspended'},
            ),
          ),
        );
        when(() => authRepository.generateOtp('learner@example.com')).thenAnswer((_) async => null);

        await preWarmTranslations(tester);
        await pumpRouterApp(
          tester,
          initialLocation: '/login',
          routes: [
            GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
            GoRoute(path: '/suspended', builder: (context, state) => const Text('Suspended Screen')),
          ],
          overrides: [
            authRepositoryProvider.overrideWithValue(authRepository),
            authControllerProvider.overrideWith(() => authController),
          ],
        );

        await tester.enterText(find.byType(TextField), 'learner@example.com');
        await tester.pump();
        await tester.tap(find.text('Next'));
        await tester.pumpAndSettle();
        await enterOtp(tester, '1234');
        await tester.tap(find.text('Verify'));
        await tester.pumpAndSettle();

        expect(find.text('Suspended Screen'), findsOneWidget);
        expect(authController.signInCalls, 0);
      },
    );

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

    testWidgets('shows a 60s resend countdown that disables Resend, then re-enables it', (tester) async {
      await advanceToOtpStep(tester);

      expect(find.text('Resend (60s)'), findsOneWidget);
      var resendButton = tester.widget<TextButton>(find.widgetWithText(TextButton, 'Resend (60s)'));
      expect(resendButton.onPressed, isNull);

      await tester.pump(const Duration(seconds: 60));

      expect(find.text('Resend'), findsOneWidget);
      resendButton = tester.widget<TextButton>(find.widgetWithText(TextButton, 'Resend'));
      expect(resendButton.onPressed, isNotNull);
    });

    testWidgets(
      'tapping Resend once enabled calls generateOtp again, clears the boxes, and restarts the countdown',
      (tester) async {
        await advanceToOtpStep(tester);
        await enterOtp(tester, '1234');
        await tester.pump(const Duration(seconds: 60));

        when(() => authRepository.generateOtp('learner@example.com')).thenAnswer((_) async => 120);

        await tester.tap(find.text('Resend'));
        await tester.pumpAndSettle();

        verify(() => authRepository.generateOtp('learner@example.com')).called(2);
        expect(find.text('Resend (60s)'), findsOneWidget);
        final verifyButton = tester.widget<AppButton>(find.widgetWithText(AppButton, 'Verify'));
        expect(verifyButton.isDisabled, isTrue, reason: 'resending clears the previously entered digits');
      },
    );

    testWidgets('shows the expiry minutes from the real generateOtp response', (tester) async {
      when(() => authRepository.generateOtp('learner@example.com')).thenAnswer((_) async => 300);

      await pumpLogin(tester);
      await tester.enterText(find.byType(TextField), 'learner@example.com');
      await tester.pump();
      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();

      expect(find.text('This code will expire in 5. Need a new code?'), findsOneWidget);
    });
  });
}
