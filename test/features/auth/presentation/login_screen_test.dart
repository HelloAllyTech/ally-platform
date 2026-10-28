import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:lottie/lottie.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

import 'package:ally_mobile_flutter/core/auth/auth_state.dart';
import 'package:ally_mobile_flutter/core/config/app_config.dart';
import 'package:ally_mobile_flutter/core/widgets/app_button.dart';
import 'package:ally_mobile_flutter/features/auth/data/auth_repository.dart';
import 'package:ally_mobile_flutter/features/auth/presentation/login_screen.dart';

import '../../../support/fake_translations.dart';
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

  /// An iPhone 17 Pro-sized surface (402×874pt): the sheet's geometry is
  /// fractions of the screen height, so the default 800×600 test surface
  /// would push the lower buttons out of view.
  void usePhoneSurface(WidgetTester tester) {
    tester.view.physicalSize = const Size(1206, 2622);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
  }

  Future<void> pumpLogin(WidgetTester tester) async {
    usePhoneSurface(tester);
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

  Finder emailField() => find.byType(TextField);

  group('splash intro', () {
    testWidgets('plays the real splash Lottie full-bleed, then raises the sheet with the greeting', (tester) async {
      usePhoneSurface(tester);
      await preWarmTranslations(tester);
      SharedPreferences.setMockInitialValues({});
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            fixedTranslationsOverride(),
            authRepositoryProvider.overrideWithValue(authRepository),
            authControllerProvider.overrideWith(() => authController),
          ],
          child: const MaterialApp(home: LoginScreen()),
        ),
      );
      await tester.pump();

      final builder = tester.widget<LottieBuilder>(find.byType(LottieBuilder));
      expect((builder.lottie as AssetLottie).assetName, 'assets/animations/splashAnimation.json');
      expect(builder.fit, BoxFit.cover);
      // While the animation plays, the sheet hasn't been shown yet.
      expect(find.text('Next'), findsNothing);

      await tester.pumpAndSettle();
      expect(find.text('Next'), findsOneWidget);
      expect(find.text('Hey,'), findsOneWidget);
    });
  });

  testWidgets('the status bar is dark-content, as RN sets it after the splash', (tester) async {
    await pumpLogin(tester);
    final region = tester.widget<AnnotatedRegion<SystemUiOverlayStyle>>(
      find.descendant(
        of: find.byType(LoginScreen),
        matching: find.byWidgetPredicate((w) => w is AnnotatedRegion<SystemUiOverlayStyle>),
      ).first,
    );
    expect(region.value.statusBarIconBrightness, Brightness.dark);
    expect(region.value.statusBarBrightness, Brightness.light);
  });

  group('email step', () {
    testWidgets('disables Next for an empty or invalid-shaped email, enables it once valid '
        '(RN\'s isValidEmail gate)', (tester) async {
      await pumpLogin(tester);

      var nextButton = tester.widget<AppButton>(find.widgetWithText(AppButton, 'Next'));
      expect(nextButton.isDisabled, isTrue, reason: 'empty');

      await tester.enterText(emailField(), 'not-an-email');
      await tester.pump();
      nextButton = tester.widget<AppButton>(find.widgetWithText(AppButton, 'Next'));
      expect(nextButton.isDisabled, isTrue, reason: 'no @ or domain');

      await tester.enterText(emailField(), 'learner@example.com');
      await tester.pump();
      nextButton = tester.widget<AppButton>(find.widgetWithText(AppButton, 'Next'));
      expect(nextButton.isDisabled, isFalse);

      verifyNever(() => authRepository.generateOtp(any()));
    });

    testWidgets('lower-cases and strips spaces as typed (RN handleEmailChange)', (tester) async {
      await pumpLogin(tester);

      await tester.enterText(emailField(), ' Learner@Example.COM ');
      await tester.pump();

      expect(tester.widget<TextField>(emailField()).controller!.text, 'learner@example.com');
    });

    testWidgets('calls generateOtp and advances to the OTP step on success', (tester) async {
      when(() => authRepository.generateOtp('learner@example.com')).thenAnswer((_) async => null);

      await pumpLogin(tester);

      await tester.enterText(emailField(), 'learner@example.com');
      await tester.pump();
      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();

      verify(() => authRepository.generateOtp('learner@example.com')).called(1);
      // Two separately-styled spans in one `Text.rich` (RN's headerText +
      // emailText) — rendered on their own line, not one flat sentence.
      expect(find.text('Enter the security code sent to\nlearner@example.com'), findsOneWidget);
    });

    testWidgets('shows RN\'s "Failed to Send OTP" alert when generateOtp fails', (tester) async {
      when(() => authRepository.generateOtp(any())).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/v1/auth/generate-otp'),
          response: Response(
            requestOptions: RequestOptions(path: '/v1/auth/generate-otp'),
            statusCode: 400,
            data: {'message': 'No account for this email'},
          ),
        ),
      );

      await pumpLogin(tester);

      await tester.enterText(emailField(), 'learner@example.com');
      await tester.pump();
      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();

      expect(find.text('Failed to Send OTP'), findsOneWidget);
      expect(find.text('No account for this email'), findsOneWidget);

      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      expect(find.text('Failed to Send OTP'), findsNothing);
      expect(find.text('Next'), findsOneWidget, reason: 'stays on the email step');
    });

    testWidgets('a network failure says to check the connection', (tester) async {
      when(() => authRepository.generateOtp(any())).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/v1/auth/generate-otp'),
          type: DioExceptionType.connectionError,
        ),
      );

      await pumpLogin(tester);
      await tester.enterText(emailField(), 'learner@example.com');
      await tester.pump();
      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();

      expect(find.text('Please check your internet connection and try again.'), findsOneWidget);
    });

    testWidgets('shows the real two-line greeting ("Hey," then "Welcome to Ally"), '
        'which switches to a single OTP-step line once advanced', (tester) async {
      when(() => authRepository.generateOtp(any())).thenAnswer((_) async => null);

      await pumpLogin(tester);

      expect(find.text('Hey,'), findsOneWidget);
      expect(find.text('Welcome to Ally'), findsOneWidget);

      await tester.enterText(emailField(), 'learner@example.com');
      await tester.pump();
      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();

      expect(find.text('Hey,'), findsNothing);
      expect(find.text('Welcome to Ally'), findsNothing);
      expect(find.text('Verify your email address'), findsOneWidget);
    });

    testWidgets('disables the Google button when googleWebClientId is empty', (tester) async {
      await pumpLogin(tester);

      // The real default (no --dart-define passed in tests).
      expect(AppConfig.googleWebClientId, isEmpty);

      final button = tester.widget<GestureDetector>(find.byKey(const Key('google-login-button')));
      expect(button.onTap, isNull);
    });

    testWidgets('only shows the Apple button on iOS', (tester) async {
      await pumpLogin(tester);

      expect(Platform.isIOS, isFalse);
      expect(find.byType(SignInWithAppleButton), findsNothing);
    });

    testWidgets('on iOS the Apple button is RN\'s solid black "Continue with Apple" pill', (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      try {
        await pumpLogin(tester);

        final apple = tester.widget<SignInWithAppleButton>(find.byType(SignInWithAppleButton));
        expect(apple.style, SignInWithAppleButtonStyle.black);
        expect(apple.text, 'Continue with Apple');
      } finally {
        debugDefaultTargetPlatformOverride = null;
      }
    });

    testWidgets('shows the subtitle, the real Google logo, and the Terms/Privacy footer with its real double period', (
      tester,
    ) async {
      await pumpLogin(tester);

      expect(find.text('Enter your email address to continue'), findsOneWidget);

      final googleIcon = tester.widget<SvgPicture>(
        find.descendant(of: find.byKey(const Key('google-login-button')), matching: find.byType(SvgPicture)),
      );
      expect((googleIcon.bytesLoader as SvgAssetLoader).assetName, 'assets/icons/google.svg');
      expect(find.text('Continue with Google'), findsOneWidget);

      expect(find.textContaining("By proceeding, i agree to Ally's"), findsOneWidget);
      expect(find.textContaining('Privacy Policy..'), findsOneWidget);
    });
  });

  group('otp step', () {
    Future<void> advanceToOtpStep(WidgetTester tester) async {
      when(() => authRepository.generateOtp('learner@example.com')).thenAnswer((_) async => null);
      await pumpLogin(tester);
      await tester.enterText(emailField(), 'learner@example.com');
      await tester.pump();
      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();
    }

    Finder otpInput() => find.byKey(const Key('otp-input'));

    /// The digit rendered in box [index] (null when empty).
    String? boxDigit(WidgetTester tester, int index) {
      final texts = find.descendant(of: find.byKey(Key('otp-box-$index')), matching: find.byType(Text));
      if (texts.evaluate().isEmpty) return null;
      return tester.widget<Text>(texts.first).data;
    }

    List<String?> boxDigits(WidgetTester tester) => [for (var i = 0; i < 4; i++) boxDigit(tester, i)];

    Future<void> enterOtp(WidgetTester tester, String digits) async {
      await tester.enterText(otpInput(), digits);
      await tester.pump();
    }

    testWidgets('keeps the hero on the OTP step and shows RN\'s back arrow', (tester) async {
      await advanceToOtpStep(tester);

      expect(find.byType(LottieBuilder), findsOneWidget);
      expect(find.byKey(const Key('otp-back-button')), findsOneWidget);
    });

    testWidgets('the back arrow returns to the email step with an empty field (RN remounts EmailLogin)', (
      tester,
    ) async {
      await advanceToOtpStep(tester);

      await tester.tap(find.byKey(const Key('otp-back-button')));
      await tester.pumpAndSettle();

      expect(find.text('Next'), findsOneWidget);
      expect(find.text('Hey,'), findsOneWidget);
      expect(find.byKey(const Key('otp-back-button')), findsNothing);
      expect(tester.widget<TextField>(emailField()).controller!.text, isEmpty);
    });

    testWidgets('four rapid keystrokes fill all four boxes in order', (tester) async {
      await advanceToOtpStep(tester);

      await tester.showKeyboard(otpInput());
      // Separate keystrokes with no frame in between — the old per-box
      // fields lost these because focus hadn't moved yet.
      tester.testTextInput.enterText('1');
      tester.testTextInput.enterText('12');
      tester.testTextInput.enterText('123');
      tester.testTextInput.enterText('1234');
      await tester.pump();

      expect(boxDigits(tester), ['1', '2', '3', '4']);
      expect(tester.widget<AppButton>(find.widgetWithText(AppButton, 'Verify')).isDisabled, isFalse);
    });

    testWidgets('a pasted or autofilled code fills all four boxes; extras and non-digits are dropped', (tester) async {
      await advanceToOtpStep(tester);

      final field = tester.widget<TextField>(otpInput());
      expect(field.autofillHints, contains(AutofillHints.oneTimeCode));

      await enterOtp(tester, '5678');
      expect(boxDigits(tester), ['5', '6', '7', '8']);

      await enterOtp(tester, '');
      await enterOtp(tester, '12-34 99');
      expect(boxDigits(tester), ['1', '2', '3', '4']);
    });

    testWidgets('disables Verify until all 4 digits are entered, then enables it', (tester) async {
      await advanceToOtpStep(tester);

      var verifyButton = tester.widget<AppButton>(find.widgetWithText(AppButton, 'Verify'));
      expect(verifyButton.isDisabled, isTrue);

      await enterOtp(tester, '123');
      verifyButton = tester.widget<AppButton>(find.widgetWithText(AppButton, 'Verify'));
      expect(verifyButton.isDisabled, isTrue, reason: 'only 3 of 4 boxes filled');
      expect(boxDigits(tester), ['1', '2', '3', null]);

      await enterOtp(tester, '1234');
      verifyButton = tester.widget<AppButton>(find.widgetWithText(AppButton, 'Verify'));
      expect(verifyButton.isDisabled, isFalse);

      verifyNever(
        () => authRepository.verifyOtp(
          email: any(named: 'email'),
          otp: any(named: 'otp'),
        ),
      );
    });

    testWidgets('calls verifyOtp, shows the terms modal, and only signs in once agreed', (tester) async {
      when(() => authRepository.verifyOtp(email: 'learner@example.com', otp: '1234'))
          .thenAnswer((_) async => ('access-tok', 'refresh-tok'));

      await advanceToOtpStep(tester);
      await enterOtp(tester, '1234');
      await tester.tap(find.text('Verify'));
      await tester.pumpAndSettle();

      verify(() => authRepository.verifyOtp(email: 'learner@example.com', otp: '1234')).called(1);
      expect(authController.signInCalls, 0, reason: 'tokens are held until the terms are agreed to');
      expect(find.text('Terms and agreement'), findsOneWidget);
      expect(
        tester.widget<AppButton>(find.widgetWithText(AppButton, 'Verify')).isDisabled,
        isTrue,
        reason: 'RN disables Verify while the terms modal is up',
      );

      await tester.tap(find.byKey(const Key('scroll-to-bottom-button')));
      await tester.pumpAndSettle();

      final agreeButtonBefore = tester.widget<AppButton>(find.widgetWithText(AppButton, 'Agree'));
      expect(agreeButtonBefore.isDisabled, isTrue, reason: 'unchecked');

      await tester.tap(find.byKey(const Key('agree-checkbox-container')));
      await tester.pump();

      expect(tester.widget<AppButton>(find.widgetWithText(AppButton, 'Agree')).isDisabled, isFalse);

      await tester.tap(find.widgetWithText(AppButton, 'Agree'));
      await tester.pumpAndSettle();

      expect(authController.signInCalls, 1);
      expect(authController.lastAccessToken, 'access-tok');
      expect(authController.lastRefreshToken, 'refresh-tok');
    });

    testWidgets('shows the backend\'s message in the error box when verifyOtp fails', (tester) async {
      when(
        () => authRepository.verifyOtp(
          email: any(named: 'email'),
          otp: any(named: 'otp'),
        ),
      ).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/v1/auth/verify-otp'),
          response: Response(
            requestOptions: RequestOptions(path: '/v1/auth/verify-otp'),
            statusCode: 400,
            data: {'message': 'Invalid OTP'},
          ),
        ),
      );

      await advanceToOtpStep(tester);
      await enterOtp(tester, '0000');
      await tester.tap(find.text('Verify'));
      await tester.pumpAndSettle();

      expect(find.text('Invalid OTP'), findsOneWidget);
      expect(authController.signInCalls, 0);

      // Typing again clears the error (RN handleOtpChange).
      await enterOtp(tester, '000');
      expect(find.text('Invalid OTP'), findsNothing);
    });

    testWidgets('a non-API verify failure falls back to "Something went wrong!"', (tester) async {
      when(
        () => authRepository.verifyOtp(
          email: any(named: 'email'),
          otp: any(named: 'otp'),
        ),
      ).thenThrow(Exception('bad code'));

      await advanceToOtpStep(tester);
      await enterOtp(tester, '0000');
      await tester.tap(find.text('Verify'));
      await tester.pumpAndSettle();

      expect(find.text('Something went wrong!'), findsOneWidget);
    });

    testWidgets('a 403 USER_SUSPENDED response routes to /suspended instead of showing a generic error', (
      tester,
    ) async {
      when(
        () => authRepository.verifyOtp(
          email: any(named: 'email'),
          otp: any(named: 'otp'),
        ),
      ).thenThrow(
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

      usePhoneSurface(tester);
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

      await tester.enterText(emailField(), 'learner@example.com');
      await tester.pump();
      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();
      await enterOtp(tester, '1234');
      await tester.tap(find.text('Verify'));
      await tester.pumpAndSettle();

      expect(find.text('Suspended Screen'), findsOneWidget);
      expect(authController.signInCalls, 0);
      // RN replaces the login screen: nothing to go back to.
      expect(GoRouter.of(tester.element(find.text('Suspended Screen'))).canPop(), isFalse);
    });

    testWidgets('shows a 60s resend countdown that disables Resend, then re-enables it', (tester) async {
      await advanceToOtpStep(tester);

      expect(find.text('Resend (60s)'), findsOneWidget);
      var resend = tester.widget<GestureDetector>(find.byKey(const Key('otp-resend')));
      expect(resend.onTap, isNull);

      await tester.pump(const Duration(seconds: 60));

      expect(find.text('Resend'), findsOneWidget);
      resend = tester.widget<GestureDetector>(find.byKey(const Key('otp-resend')));
      expect(resend.onTap, isNotNull);
    });

    testWidgets('tapping Resend once enabled calls generateOtp again, clears the boxes, and restarts the countdown', (
      tester,
    ) async {
      await advanceToOtpStep(tester);
      await enterOtp(tester, '1234');
      await tester.pump(const Duration(seconds: 60));

      when(() => authRepository.generateOtp('learner@example.com')).thenAnswer((_) async => 120);

      await tester.tap(find.text('Resend'));
      await tester.pumpAndSettle();

      verify(() => authRepository.generateOtp('learner@example.com')).called(2);
      expect(find.text('Resend (60s)'), findsOneWidget);
      expect(boxDigits(tester), [null, null, null, null]);
      final verifyButton = tester.widget<AppButton>(find.widgetWithText(AppButton, 'Verify'));
      expect(verifyButton.isDisabled, isTrue, reason: 'resending clears the previously entered digits');
    });

    testWidgets('shows the expiry minutes from the real generateOtp response', (tester) async {
      when(() => authRepository.generateOtp('learner@example.com')).thenAnswer((_) async => 300);

      await pumpLogin(tester);
      await tester.enterText(emailField(), 'learner@example.com');
      await tester.pump();
      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();

      expect(find.text('This code will expire in 5 minutes. Need a new code?'), findsOneWidget);
    });

    testWidgets('uses the singular unit for a one-minute code', (tester) async {
      when(() => authRepository.generateOtp('learner@example.com')).thenAnswer((_) async => 60);

      await pumpLogin(tester);
      await tester.enterText(emailField(), 'learner@example.com');
      await tester.pump();
      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();

      expect(find.text('This code will expire in 1 minute. Need a new code?'), findsOneWidget);
    });
  });
}
