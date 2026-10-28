import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/cupertino.dart' show CupertinoDialogAction;
import 'package:flutter/foundation.dart' show TargetPlatform, defaultTargetPlatform;
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:lottie/lottie.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/auth/auth_state.dart';
import '../../../core/config/app_config.dart';
import '../../../core/localization/translate_ref.dart';
import '../../../core/routing/launch_splash.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/app_radius.dart';
import '../../../core/widgets/app_button.dart';
import '../data/auth_repository.dart';
import 'terms_and_agreement_modal.dart';

// RN's src/constants/general.ts.
const _termsAndConditionsUrl = 'https://app.helloally.ai/terms';
const _privacyPolicyUrl = 'https://app.helloally.ai/privacy';
const _otpLength = 4;
const _resendCountdownSeconds = 60;
const _defaultOtpExpiryMinutes = 10;

/// iOS system font (SF Pro) — what an RN `<Text>` with no `fontFamily`
/// renders in. Falls back to the platform default elsewhere.
const _systemFont = 'CupertinoSystemText';


/// RN's `withTiming(-WINDOW_HEIGHT * 0.6, {duration: 1000})` — reanimated's
/// default easing is `Easing.inOut(Easing.quad)`.
const _sheetDuration = Duration(milliseconds: 1000);

/// RN's `isValidEmail` (`src/utils/common.ts`) — same regex, gates the
/// "Next" button there (`isDisabled={!isValidEmail(email)}`).
final _emailRegex = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');
bool _isValidEmail(String email) => _emailRegex.hasMatch(email);

/// RN's `isSuspendedUserError` (`src/utils/error.ts`) — a 403 whose body
/// carries `error: 'USER_SUSPENDED'` or the literal message `'User
/// suspended'`. Checked after every sign-in method (OTP, Google, Apple) so a
/// suspended account reaches SuspendedAccountScreen instead of a generic
/// error, same as RN's OtpVerification/useGoogleLogin/useAppleLogin hooks.
bool _isSuspendedUserError(Object error) {
  if (error is! DioException) return false;
  if (error.response?.statusCode != 403) return false;
  final data = error.response?.data;
  if (data is! Map) return false;
  return data['error'] == 'USER_SUSPENDED' || data['message'] == 'User suspended';
}

/// RN's `getErrorDetails(error).message` (`src/utils/error.ts`): the
/// backend body's `message`, else its `error`, else `null` (callers supply
/// their own fallback, as RN's do).
String? _apiErrorMessage(Object error) {
  if (error is! DioException) return null;
  final data = error.response?.data;
  if (data is! Map) return null;
  for (final key in ['message', 'error']) {
    final value = data[key];
    if (value is String && value.isNotEmpty) return value;
  }
  return null;
}

/// Lower-cases and strips whitespace as the learner types — RN's
/// `handleEmailChange` (`setEmail(text.trim().toLowerCase())`).
class _EmailInputFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) {
    final text = newValue.text.trim().toLowerCase();
    if (text == newValue.text) return newValue;
    return TextEditingValue(
      text: text,
      selection: TextSelection.collapsed(offset: text.length),
    );
  }
}

/// Port of ally-mobile (React Native)'s `src/screens/SplashScreen/` — the
/// screen that is both the cold-launch splash and the sign-in flow:
///
/// * `SplashScreen.tsx`: the full-bleed splash Lottie plays once on the
///   dark-green background; when it finishes (and nobody is signed in) the
///   hero slides up 60% of the screen while the white, top-rounded sheet
///   rises from the bottom and the greeting fades in over the hero. On the
///   OTP step the hero stays put; only the title changes and a back arrow
///   appears top-left.
/// * `components/EmailLogin`: email + Next, "OR", Google and (iOS) Apple
///   buttons, terms footer.
/// * `components/OtpVerification` + `components/OtpInput`: four code boxes,
///   expiry/resend copy, Verify pinned to the bottom of the sheet.
///
/// Email+OTP, Google and Apple sign-in match RN's `generateOtp`/`verifyOtp`/
/// `loginWithGoogle`/`loginWithApple` contracts. Google/Apple can't
/// complete a real round-trip until this app's own distinct package name
/// has an OAuth client registered — see auth_repository.dart's doc comment
/// — so the Google button disables itself when unconfigured and Apple
/// surfaces the backend's real rejection.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

enum _Step { email, otp }

class _LoginScreenState extends ConsumerState<LoginScreen> with TickerProviderStateMixin {
  final _emailController = TextEditingController();
  final _emailFocusNode = FocusNode();
  final _otpController = TextEditingController();
  final _otpFocusNode = FocusNode();

  late final AnimationController _lottieController;
  late final AnimationController _sheetController;
  bool _isSheetVisible = false;
  bool _isSheetFullyOpen = false;

  _Step _step = _Step.email;
  bool _isOtpLoading = false;
  bool _isGoogleLoading = false;
  bool _isAppleLoading = false;
  bool _isVerifying = false;
  bool _isResending = false;
  bool _isShowingTerms = false;
  String? _otpError;
  Timer? _resendTimer;
  int _resendCountdown = 0;
  int _otpExpiryMinutes = _defaultOtpExpiryMinutes;

  /// `GoogleSignIn.instance.initialize` must be called exactly once and
  /// awaited before any other call on the singleton — scheduled on mount
  /// (same timing as the RN hook's `useEffect`), only actually awaited
  /// when the learner taps the button.
  Future<void>? _googleInitFuture;

  @override
  void initState() {
    super.initState();
    if (AppConfig.googleWebClientId.isNotEmpty) {
      _googleInitFuture = GoogleSignIn.instance.initialize(
        clientId: defaultTargetPlatform == TargetPlatform.iOS && AppConfig.googleIosClientId.isNotEmpty
            ? AppConfig.googleIosClientId
            : null,
        serverClientId: AppConfig.googleWebClientId,
      );
    }
    _emailController.addListener(_rebuild);
    _emailFocusNode.addListener(_rebuild);
    _otpFocusNode.addListener(_rebuild);
    _otpController.addListener(_keepOtpCaretAtEnd);

    _sheetController = AnimationController(vsync: this, duration: _sheetDuration);
    _lottieController = AnimationController(vsync: this, duration: kSplashLottieDuration);
    if (ref.read(launchSplashProvider.notifier).takeLoginHandOff()) {
      // Cold start: `/splash` already played the animation (RN's splash and
      // login are one screen), so start settled and raise the sheet.
      _lottieController.value = kSplashSettledProgress;
      WidgetsBinding.instance.addPostFrameCallback((_) => _onAnimationFinish(fromLaunchSplash: true));
    } else {
      // A sign-out remounts RN's SplashScreen: status bar hidden, replay.
      hideStatusBarForSplash();
      _lottieController.animateTo(kSplashPlayToProgress).then((_) => _onAnimationFinish());
    }
  }

  @override
  void dispose() {
    _emailController.dispose();
    _emailFocusNode.dispose();
    _otpController.dispose();
    _otpFocusNode.dispose();
    _lottieController.dispose();
    _sheetController.dispose();
    _termsRecognizer.dispose();
    _privacyRecognizer.dispose();
    _resendTimer?.cancel();
    super.dispose();
  }

  void _rebuild() => setState(() {});

  /// The boxes always fill left to right, so a tap on, say, the first box
  /// must not put the hidden field's caret before the digits already typed.
  void _keepOtpCaretAtEnd() {
    final end = _otpController.text.length;
    final selection = _otpController.selection;
    // Only a moved caret; a select-all (to paste over) is left alone.
    if (selection.isValid && selection.isCollapsed && selection.baseOffset != end) {
      _otpController.selection = TextSelection.collapsed(offset: end);
    }
  }

  /// RN's `onAnimationFinish` + the effect that calls `displayBottomSheet`
  /// once the animation has ended and the user is not signed in (a signed-in
  /// user is routed away by the router's auth redirect instead).
  void _onAnimationFinish({bool fromLaunchSplash = false}) {
    if (!mounted) return;
    _lottieController.value = kSplashSettledProgress;
    if (!fromLaunchSplash) showStatusBarAfterSplash();
    if (ref.read(authControllerProvider).isAuthenticated || _isSheetVisible) return;
    setState(() => _isSheetVisible = true);
    _sheetController.forward().then((_) {
      if (mounted) setState(() => _isSheetFullyOpen = true);
    });
  }

  bool get _isLoading => _isOtpLoading || _isGoogleLoading || _isAppleLoading;

  bool get _isOtpComplete => _otpController.text.length == _otpLength;

  void _showToast(String message) {
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(message)));
  }

  void _startResendCountdown(int? expiresInSeconds) {
    _resendTimer?.cancel();
    setState(() {
      _resendCountdown = _resendCountdownSeconds;
      _otpExpiryMinutes = expiresInSeconds != null ? (expiresInSeconds / 60).ceil() : _defaultOtpExpiryMinutes;
    });
    _resendTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (_resendCountdown <= 1) {
        timer.cancel();
        setState(() => _resendCountdown = 0);
      } else {
        setState(() => _resendCountdown--);
      }
    });
  }

  /// RN's `useGoogleLogin`/`useAppleLogin` error handling: a suspended
  /// account goes to SuspendedAccountScreen, any other backend error is a
  /// toast with the backend's message (or the generic fallback). Anything
  /// else (no id token, say) is only logged by RN: no toast.
  void _handleSocialLoginError(Object error, String fallbackKey) {
    if (error is! DioException) return;
    if (_isSuspendedUserError(error)) {
      // RN `navigation.replace(SUSPENDED_ACCOUNT)`: back can't return here.
      if (mounted) context.go('/suspended');
      return;
    }
    _showToast(_apiErrorMessage(error) ?? ref.tr(fallbackKey));
  }

  Future<void> _completeSocialLogin((String, String) tokens) async {
    if (!mounted) return;
    await TermsAndAgreementModal.show(context);
    await ref.read(authControllerProvider.notifier).signIn(accessToken: tokens.$1, refreshToken: tokens.$2);
  }

  Future<void> _signInWithGoogle() async {
    final initFuture = _googleInitFuture;
    if (initFuture == null) return;
    setState(() => _isGoogleLoading = true);
    (String, String)? tokens;
    try {
      await initFuture;
      try {
        await GoogleSignIn.instance.signOut();
      } catch (_) {
        // Optional, same as the RN hook: forces the account picker instead
        // of silently reusing a stale cached session.
      }
      final account = await GoogleSignIn.instance.authenticate();
      final idToken = account.authentication.idToken;
      if (idToken == null) {
        throw StateError('No ID token returned from Google');
      }
      tokens = await ref.read(authRepositoryProvider).loginWithGoogle(idToken);
    } on GoogleSignInException catch (e) {
      // RN: cancel is silent; any other SDK error toasts the SDK's own
      // message, else "Failed to sign in with Google".
      if (e.code != GoogleSignInExceptionCode.canceled) {
        final description = e.description;
        _showToast(description != null && description.isNotEmpty ? description : ref.tr('auth.login.google.error'));
      }
    } catch (e) {
      _handleSocialLoginError(e, 'auth.login.google.error');
    } finally {
      if (mounted) setState(() => _isGoogleLoading = false);
    }
    if (tokens != null) await _completeSocialLogin(tokens);
  }

  Future<void> _signInWithApple() async {
    setState(() => _isAppleLoading = true);
    (String, String)? tokens;
    try {
      final credential = await SignInWithApple.getAppleIDCredential(
        scopes: [AppleIDAuthorizationScopes.email, AppleIDAuthorizationScopes.fullName],
      );
      final identityToken = credential.identityToken;
      if (identityToken == null) {
        throw StateError('No identity token returned from Apple');
      }
      tokens = await ref
          .read(authRepositoryProvider)
          .loginWithApple(
            identityToken: identityToken,
            authorizationCode: credential.authorizationCode,
            givenName: credential.givenName,
            familyName: credential.familyName,
          );
    } on SignInWithAppleAuthorizationException catch (e) {
      // RN: cancel is silent; others toast `err.message`, else the fallback.
      if (e.code != AuthorizationErrorCode.canceled) {
        _showToast(e.message.isNotEmpty ? e.message : ref.tr('auth.login.apple.error'));
      }
    } catch (e) {
      _handleSocialLoginError(e, 'auth.login.apple.error');
    } finally {
      if (mounted) setState(() => _isAppleLoading = false);
    }
    if (tokens != null) await _completeSocialLogin(tokens);
  }

  Future<void> _sendCode() async {
    final email = _emailController.text;
    if (!_isValidEmail(email) || _isLoading) return;
    setState(() => _isOtpLoading = true);
    int? expiresIn;
    try {
      expiresIn = await ref.read(authRepositoryProvider).generateOtp(email);
    } catch (e) {
      if (!mounted) return;
      setState(() => _isOtpLoading = false);
      await _showSendOtpFailedAlert(e);
      return;
    }
    if (!mounted) return;
    setState(() {
      _isOtpLoading = false;
      _step = _Step.otp;
      _otpController.clear();
      _otpError = null;
    });
    _startResendCountdown(expiresIn);
  }

  /// RN's EmailLogin `handleOtpError`: an `Alert.alert` titled "Failed to
  /// Send OTP" with the backend message, "check your internet" for a
  /// network failure, or "Unknown error".
  Future<void> _showSendOtpFailedAlert(Object error) {
    final isNetworkError = error is DioException && error.response == null;
    final message = isNetworkError
        ? ref.tr('common.checkInternet')
        : _apiErrorMessage(error) ?? ref.tr('common.unknownError');
    return showAdaptiveDialog<void>(
      context: context,
      builder: (context) => AlertDialog.adaptive(
        title: Text(ref.tr('auth.login.errors.sendOtpFailed')),
        content: Text(message),
        actions: [
          if (defaultTargetPlatform == TargetPlatform.iOS)
            CupertinoDialogAction(onPressed: () => Navigator.of(context).pop(), child: Text(ref.tr('common.ok')))
          else
            TextButton(onPressed: () => Navigator.of(context).pop(), child: Text(ref.tr('common.ok'))),
        ],
      ),
    );
  }

  Future<void> _resendOtp() async {
    setState(() => _isResending = true);
    try {
      final expiresIn = await ref.read(authRepositoryProvider).generateOtp(_emailController.text);
      if (!mounted) return;
      setState(() {
        _otpController.clear();
        _otpError = null;
      });
      _startResendCountdown(expiresIn);
      _otpFocusNode.requestFocus();
    } catch (e) {
      if (mounted) _showToast(_apiErrorMessage(e) ?? ref.tr('common.somethingWentWrong'));
    } finally {
      if (mounted) setState(() => _isResending = false);
    }
  }

  Future<void> _verifyCode() async {
    final otp = _otpController.text;
    setState(() {
      _isVerifying = true;
      _otpError = null;
    });
    (String, String) tokens;
    try {
      tokens = await ref.read(authRepositoryProvider).verifyOtp(email: _emailController.text, otp: otp);
    } catch (e) {
      if (!mounted) return;
      setState(() => _isVerifying = false);
      if (_isSuspendedUserError(e)) {
        context.go('/suspended');
      } else {
        setState(() => _otpError = _apiErrorMessage(e) ?? ref.tr('common.somethingWentWrong'));
      }
      return;
    }
    if (!mounted) return;
    // RN: Verify stops loading and is disabled (`isDisabled={... ||
    // showTermsModal}`) while the terms modal is up.
    setState(() {
      _isVerifying = false;
      _isShowingTerms = true;
    });
    await TermsAndAgreementModal.show(context);
    if (mounted) setState(() => _isShowingTerms = false);
    await ref.read(authControllerProvider.notifier).signIn(accessToken: tokens.$1, refreshToken: tokens.$2);
  }

  /// RN's `handleBackPress` / hardware back on the OTP step. RN unmounts
  /// EmailLogin while on the OTP step, so its email field comes back empty.
  void _backToEmail() {
    _resendTimer?.cancel();
    setState(() {
      _step = _Step.email;
      _emailController.clear();
      _otpController.clear();
      _otpError = null;
      _resendCountdown = 0;
    });
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    final h = size.height;

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: PopScope(
        canPop: _step == _Step.email,
        onPopInvokedWithResult: (didPop, _) {
          if (!didPop && _step == _Step.otp) _backToEmail();
        },
        child: Scaffold(
          backgroundColor: AppColors.darkGreen,
          // RN's sheet geometry is fixed fractions of WINDOW_HEIGHT; the
          // keyboard doesn't resize it (KeyboardAwareScrollView with
          // automatic scroll off on iOS), it only adds scrollable room.
          resizeToAvoidBottomInset: false,
          body: GestureDetector(
            // RN wraps the screen in TouchableWithoutFeedback → Keyboard.dismiss.
            onTap: () => FocusScope.of(context).unfocus(),
            child: AnimatedBuilder(
              animation: _sheetController,
              // Built once per State.build() (a `setState` from text/step/
              // loading changes), NOT on every one of the sheet animation's
              // ~60 ticks. Passing it as `child` instead of building the
              // email/OTP form (TextField, SVG buttons, rich-text footer)
              // inline in `builder` was the difference between the sheet
              // gliding up and visibly stuttering: rebuilding that whole
              // subtree every frame, on top of the Lottie still compositing
              // underneath, was enough work per frame to miss 60fps in
              // debug — RN's Reanimated equivalent runs the whole gesture on
              // the UI thread and never re-renders the form at all.
              child: _step == _Step.email ? _buildEmailStep(context, size) : _buildOtpStep(context, size),
              builder: (context, sheetContent) {
                final eased = Curves.easeInOutQuad.transform(_sheetController.value);
                // animationTranslateY.value, as a fraction of WINDOW_HEIGHT.
                final translate = 0.6 * eased;
                return Stack(
                  children: [
                    // styles.animationContainer: full-screen, translated up.
                    Positioned.fill(
                      child: Transform.translate(
                        offset: Offset(0, -translate * h),
                        child: Lottie.asset(
                          kSplashAnimationAsset,
                          controller: _lottieController,
                          fit: BoxFit.cover,
                        ),
                      ),
                    ),
                    if (_isSheetFullyOpen) _buildHeroGradient(h),
                    if (_isSheetVisible) _buildSheet(context, size, translate, sheetContent!),
                    _buildTitle(context, size, translate),
                    if (_step == _Step.otp) _buildBackButton(size),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }

  /// react-native-size-matters' `scale` (`@s`) and `verticalScale` (`@vs`)
  /// — guideline 350×680. In RnScale's logical units these reduce to a
  /// fraction of the logical screen size (the `ms` factor cancels out).
  double _s(Size size, double v) => v * size.width / 350;
  double _vs(Size size, double v) => v * size.height / 680;

  /// styles.welcomeGradientContainer: `lightGray18` at the bottom fading to
  /// transparent, bottom 58% / height 25% of the screen, under the sheet.
  Widget _buildHeroGradient(double h) {
    return Positioned(
      left: 0,
      right: 0,
      bottom: 0.58 * h,
      height: 0.25 * h,
      child: const IgnorePointer(
        child: DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.bottomCenter,
              end: Alignment.topCenter,
              colors: [AppColors.lightGray18, Color(0x00021922)],
            ),
          ),
        ),
      ),
    );
  }

  /// styles.authContainer + `authContentStyle`: rises from below the screen
  /// to 40% (minus the -18@vs margin), fading in over the first half.
  Widget _buildSheet(BuildContext context, Size size, double translate, Widget content) {
    final h = size.height;
    return Positioned(
      top: -_vs(size, 18) + h - translate * h,
      left: 0,
      right: 0,
      height: 0.65 * h,
      child: Opacity(
        opacity: (translate / 0.3).clamp(0.0, 1.0),
        child: Container(
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: content,
        ),
      ),
    );
  }

  /// styles.titleContainer/title + `textStyle`: absolutely positioned, left
  /// 30@s, translated from the bottom of the screen to 20% of the way up
  /// the sheet's travel, white ReplayPro 33/40 over the hero.
  Widget _buildTitle(BuildContext context, Size size, double translate) {
    final h = size.height;
    final progress = (translate / 0.65).clamp(0.0, 1.0);
    const titleStyle = TextStyle(
      fontFamily: AppFonts.replayProHeadline,
      fontSize: 33,
      height: 40 / 33,
      color: Colors.white,
    );
    return Positioned(
      top: h - progress * 0.8 * h - _s(size, 15),
      left: 0,
      right: 0,
      child: IgnorePointer(
        child: Opacity(
          opacity: (progress / 0.3).clamp(0.0, 1.0),
          child: Padding(
            padding: EdgeInsets.symmetric(horizontal: _s(size, 30)),
            child: _step == _Step.email
                ? Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(ref.t('auth.login.greetingLine1'), style: titleStyle),
                      Text.rich(
                        TextSpan(
                          style: titleStyle,
                          children: [
                            TextSpan(text: '${ref.t('auth.login.welcome')} '),
                            // styles.allyText
                            TextSpan(
                              text: ref.t('common.appName'),
                              style: const TextStyle(fontFamily: AppFonts.yesevaOneRegular),
                            ),
                          ],
                        ),
                      ),
                    ],
                  )
                : Text(ref.t('auth.login.otp.title'), style: titleStyle),
          ),
        ),
      ),
    );
  }

  /// styles.backButton: 40pt white circle at 70% opacity (icon included),
  /// top 62@s / left 30@s, LeftArrowIcon drawn at 44×44 in black.
  Widget _buildBackButton(Size size) {
    return Positioned(
      top: _s(size, 62),
      left: _s(size, 30),
      child: GestureDetector(
        key: const Key('otp-back-button'),
        onTap: _backToEmail,
        child: Opacity(
          opacity: 0.7,
          child: Container(
            width: 40,
            height: 40,
            decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
            alignment: Alignment.center,
            child: OverflowBox(
              maxWidth: 44,
              maxHeight: 44,
              child: SvgPicture.asset(
                'assets/icons/leftArrowIcon.svg',
                width: 44,
                height: 44,
                colorFilter: const ColorFilter.mode(Colors.black, BlendMode.srcIn),
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// RN's `EmailLogin` (+ styles.ts).
  Widget _buildEmailStep(BuildContext context, Size size) {
    final keyboardInset = MediaQuery.viewInsetsOf(context).bottom;
    final isGoogleConfigured = _googleInitFuture != null;
    return Padding(
      padding: EdgeInsets.only(top: 15, bottom: _vs(size, 20)),
      child: CustomScrollView(
        slivers: [
          SliverFillRemaining(
            hasScrollBody: false,
            child: Padding(
              padding: EdgeInsets.only(bottom: keyboardInset),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(bottom: 24),
                    child: Text(ref.t('auth.login.subtitle'), style: _sheetHeaderStyle),
                  ),
                  // styles.inputContainer: gap 8@s.
                  Text(
                    ref.t('auth.login.email.label'),
                    style: const TextStyle(
                      fontFamily: AppFonts.robotoRegular,
                      fontSize: 12,
                      height: 16 / 12,
                      letterSpacing: 0.2,
                      color: AppColors.charcoal2,
                    ),
                  ),
                  SizedBox(height: _s(size, 8)),
                  Padding(
                    padding: EdgeInsets.only(right: _s(size, 2), bottom: _vs(size, 8)),
                    child: _buildEmailInput(size),
                  ),
                  SizedBox(height: _s(size, 8)),
                  AppButton(
                    label: ref.t('common.next'),
                    onPressed: _sendCode,
                    isLoading: _isOtpLoading,
                    isDisabled: !_isValidEmail(_emailController.text),
                  ),
                  // styles.dividerContainer
                  Padding(
                    padding: EdgeInsets.only(top: _vs(size, 30), bottom: _vs(size, 22)),
                    child: Row(
                      children: [
                        const Expanded(
                          child: ColoredBox(color: AppColors.strokePrimary, child: SizedBox(height: 1)),
                        ),
                        Padding(
                          padding: EdgeInsets.symmetric(horizontal: _s(size, 10)),
                          child: Text(
                            ref.t('common.or'),
                            style: const TextStyle(
                              fontFamily: _systemFont,
                              fontSize: 12,
                              height: 16 / 12,
                              letterSpacing: 0.2,
                              color: AppColors.mediumGray,
                            ),
                          ),
                        ),
                        const Expanded(
                          child: ColoredBox(color: AppColors.strokePrimary, child: SizedBox(height: 1)),
                        ),
                      ],
                    ),
                  ),
                  _GoogleLoginButton(
                    label: ref.t('auth.login.google.button'),
                    isLoading: _isGoogleLoading,
                    isDisabled: _isLoading || !isGoogleConfigured,
                    onPressed: _signInWithGoogle,
                    verticalScale: (v) => _vs(size, v),
                  ),
                  if (defaultTargetPlatform == TargetPlatform.iOS)
                    _AppleLoginButton(
                      label: ref.t('auth.login.apple.button'),
                      isLoading: _isAppleLoading,
                      isDisabled: _isLoading,
                      onPressed: _signInWithApple,
                      height: _vs(size, 46),
                      bottomMargin: _vs(size, 10),
                    ),
                  const Spacer(),
                  _buildTermsFooter(),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// EmailLogin's `styles.input`: Roboto 14, 1pt lightGray2 border (bright
  /// blue while focused), radius 8, 16@s/10@vs padding, min height 40@vs,
  /// no placeholder.
  Widget _buildEmailInput(Size size) {
    OutlineInputBorder border(Color color) => OutlineInputBorder(
      borderRadius: BorderRadius.circular(8),
      borderSide: BorderSide(color: color),
    );
    return TextField(
      controller: _emailController,
      focusNode: _emailFocusNode,
      enabled: !_isLoading,
      keyboardType: TextInputType.emailAddress,
      autocorrect: false,
      enableSuggestions: false,
      textCapitalization: TextCapitalization.none,
      textInputAction: TextInputAction.go,
      inputFormatters: [_EmailInputFormatter()],
      onSubmitted: (_) => _sendCode(),
      style: const TextStyle(
        fontFamily: AppFonts.robotoRegular,
        fontSize: 14,
        letterSpacing: 0.25,
        fontWeight: FontWeight.w400,
        color: Colors.black,
      ),
      decoration: InputDecoration(
        isDense: true,
        filled: false,
        constraints: BoxConstraints(minHeight: _vs(size, 40)),
        contentPadding: EdgeInsets.symmetric(horizontal: _s(size, 16), vertical: _vs(size, 10)),
        border: border(AppColors.lightGray2),
        enabledBorder: border(AppColors.lightGray2),
        disabledBorder: border(AppColors.lightGray2),
        focusedBorder: border(AppColors.brightBlue),
      ),
    );
  }

  /// RN's EmailLogin footer: "By proceeding, i agree to Ally's **Terms &
  /// Conditions** and acknowledge **Privacy Policy.**." — yes, a double
  /// period: `auth.login.privacy` already ends in one, and the JSX appends
  /// a literal `.` after it regardless. Reproduced exactly, since that's
  /// what actually ships. System font, mediumGray, bright-blue links.
  Widget _buildTermsFooter() {
    const linkStyle = TextStyle(color: AppColors.brightBlue, decoration: TextDecoration.none);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: Text.rich(
        TextSpan(
          style: const TextStyle(
            fontFamily: _systemFont,
            fontSize: 12,
            height: 16 / 12,
            letterSpacing: 0.2,
            color: AppColors.mediumGray,
          ),
          children: [
            TextSpan(text: '${ref.t('auth.login.proceedAgree')} '),
            TextSpan(text: ref.t('auth.login.terms'), style: linkStyle, recognizer: _termsRecognizer),
            TextSpan(text: ' ${ref.t('auth.login.and')} '),
            TextSpan(text: ref.t('auth.login.privacy'), style: linkStyle, recognizer: _privacyRecognizer),
            const TextSpan(text: '.'),
          ],
        ),
        textAlign: TextAlign.center,
      ),
    );
  }

  late final _termsRecognizer = TapGestureRecognizer()
    ..onTap = () => launchUrl(Uri.parse(_termsAndConditionsUrl), mode: LaunchMode.externalApplication);
  late final _privacyRecognizer = TapGestureRecognizer()
    ..onTap = () => launchUrl(Uri.parse(_privacyPolicyUrl), mode: LaunchMode.externalApplication);

  /// RN's `OtpVerification` (+ styles.ts): scrollable header/code/expiry
  /// block, Verify pinned at the bottom above 54@vs of padding.
  Widget _buildOtpStep(BuildContext context, Size size) {
    final keyboardInset = MediaQuery.viewInsetsOf(context).bottom;
    final isResendDisabled = _resendCountdown > 0 || _isResending;
    return Padding(
      padding: EdgeInsets.only(bottom: _vs(size, 54)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(
            child: SingleChildScrollView(
              padding: EdgeInsets.only(top: 30, bottom: keyboardInset),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // styles.headerText with the nested styles.emailText.
                  Padding(
                    padding: const EdgeInsets.only(bottom: 24),
                    child: Text.rich(
                      TextSpan(
                        style: _sheetHeaderStyle,
                        children: [
                          TextSpan(text: ref.t('auth.login.otp.enterCode')),
                          const TextSpan(text: '\n'),
                          TextSpan(
                            text: _emailController.text,
                            style: const TextStyle(fontFamily: AppFonts.ibmPlexSerifRegular),
                          ),
                        ],
                      ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: _OtpInput(
                      controller: _otpController,
                      focusNode: _otpFocusNode,
                      hasError: _otpError != null,
                      dashWidth: _s(size, 10),
                      dashHeight: _s(size, 1),
                      onChanged: (_) => setState(() => _otpError = null),
                    ),
                  ),
                  if (_otpError != null)
                    Container(
                      margin: const EdgeInsets.only(top: 8, bottom: 16),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(color: AppColors.roseWhite, borderRadius: BorderRadius.circular(8)),
                      alignment: Alignment.center,
                      child: Text(
                        _otpError!,
                        style: const TextStyle(
                          fontFamily: _systemFont,
                          fontSize: 12,
                          height: 16 / 12,
                          letterSpacing: 0.2,
                          color: AppColors.vividRed,
                        ),
                      ),
                    ),
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          ref.t(
                            _otpExpiryMinutes == 1 ? 'auth.login.otp.expires_one' : 'auth.login.otp.expires_other',
                            {'minutes': _otpExpiryMinutes},
                          ),
                          style: _otpSmallSerif.copyWith(color: AppColors.darkSlate, height: 20 / 12),
                        ),
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: GestureDetector(
                            key: const Key('otp-resend'),
                            behavior: HitTestBehavior.opaque,
                            onTap: isResendDisabled ? null : _resendOtp,
                            child: Text(
                              _resendCountdown > 0
                                  ? '${ref.t('auth.login.otp.resend')} (${_resendCountdown}s)'
                                  : ref.t('auth.login.otp.resend'),
                              style: _otpSmallSerif.copyWith(
                                color: isResendDisabled ? AppColors.lowEmphasis : AppColors.primary,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          AppButton(
            label: ref.t('auth.login.otp.verify'),
            onPressed: _verifyCode,
            isLoading: _isVerifying,
            isDisabled: !_isOtpComplete || _isShowingTerms,
          ),
        ],
      ),
    );
  }
}

/// EmailLogin/OtpVerification `styles.headerText`: ReplayPro-Headline with
/// typography.headline.small overridden to 20pt (line height stays 32).
const _sheetHeaderStyle = TextStyle(
  fontFamily: AppFonts.replayProHeadline,
  fontSize: 20,
  height: 32 / 20,
  letterSpacing: 0,
  color: AppColors.darkSlate,
);

/// IBM_PLEX_SERIF.REGULAR + typography.body.small.
const _otpSmallSerif = TextStyle(
  fontFamily: AppFonts.ibmPlexSerifRegular,
  fontSize: 12,
  height: 16 / 12,
  letterSpacing: 0.2,
);

/// RN's `components/OtpInput` look (four 60×60 grey boxes, radius 12, a
/// short grey dash in each empty unfocused box, a red outline around each
/// box on error) — but backed by ONE hidden text field instead of four.
///
/// The previous four-`TextField` port moved focus to the next box only
/// after each character landed (focus changes reach the iOS keyboard
/// asynchronously), so fast typing hit the old box: `maxLength: 1` boxes
/// dropped the extra keystrokes and box 0's paste path overwrote the
/// others — four quick keystrokes left one digit behind. One field means
/// every keystroke, a pasted code and iOS one-time-code autofill
/// (`AutofillHints.oneTimeCode`) all land in the same controller, and the
/// boxes simply render its characters.
class _OtpInput extends StatelessWidget {
  const _OtpInput({
    required this.controller,
    required this.focusNode,
    required this.hasError,
    required this.dashWidth,
    required this.dashHeight,
    required this.onChanged,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final bool hasError;
  final double dashWidth;
  final double dashHeight;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([controller, focusNode]),
      builder: (context, _) {
        final text = controller.text;
        final focusedIndex = focusNode.hasFocus ? text.length.clamp(0, _otpLength - 1) : null;
        return Stack(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                for (var i = 0; i < _otpLength; i++) _buildBox(i, i < text.length ? text[i] : '', focusedIndex == i),
              ],
            ),
            // The real input: invisible, covering the boxes so a tap
            // anywhere on them focuses it.
            Positioned.fill(
              child: Opacity(
                opacity: 0,
                child: TextField(
                  key: const Key('otp-input'),
                  controller: controller,
                  focusNode: focusNode,
                  keyboardType: TextInputType.number,
                  autofillHints: const [AutofillHints.oneTimeCode],
                  autocorrect: false,
                  enableSuggestions: false,
                  showCursor: false,
                  maxLength: _otpLength,
                  maxLengthEnforcement: MaxLengthEnforcement.enforced,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  onChanged: onChanged,
                  decoration: const InputDecoration(
                    counterText: '',
                    border: InputBorder.none,
                    contentPadding: EdgeInsets.zero,
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _buildBox(int index, String digit, bool isFocused) {
    final box = Container(
      key: Key('otp-box-$index'),
      width: 60,
      height: 60,
      decoration: BoxDecoration(
        color: AppColors.lightGray,
        border: Border.all(color: AppColors.lightGray2),
        borderRadius: BorderRadius.circular(12),
      ),
      alignment: Alignment.center,
      child: digit.isNotEmpty
          ? Text(
              digit,
              style: const TextStyle(
                fontFamily: _systemFont,
                fontSize: 24,
                fontWeight: FontWeight.w600,
                color: Colors.black,
              ),
            )
          // The focused empty box shows the text caret, as RN's does.
          : isFocused
          ? Container(width: 2, height: 28, color: AppColors.primary)
          : null,
    );
    return Container(
      decoration: hasError
          ? BoxDecoration(
              border: Border.all(color: AppColors.vividRed),
              borderRadius: BorderRadius.circular(12),
            )
          : null,
      child: Stack(
        alignment: Alignment.center,
        children: [
          box,
          // styles.inputDash: only while empty and not focused.
          if (digit.isEmpty && !isFocused)
            Positioned(
              bottom: 20,
              child: Container(width: dashWidth, height: dashHeight, color: AppColors.gray),
            ),
        ],
      ),
    );
  }
}

/// RN's `components/Button/GoogleLoginButton`: white pill, 1pt
/// stroke-primary border, 11@vs vertical padding, the Google "G" at its
/// intrinsic 18×18, Roboto 14/22 black label; 60% opacity when disabled,
/// a spinner when loading. (RN's `fontWeight: 'semibold'` resolves to the
/// only bundled Roboto weight, Regular, on iOS.)
class _GoogleLoginButton extends StatelessWidget {
  const _GoogleLoginButton({
    required this.label,
    required this.isLoading,
    required this.isDisabled,
    required this.onPressed,
    required this.verticalScale,
  });

  final String label;
  final bool isLoading;
  final bool isDisabled;
  final VoidCallback onPressed;
  final double Function(double) verticalScale;

  @override
  Widget build(BuildContext context) {
    final disabled = isDisabled || isLoading;
    return Padding(
      padding: EdgeInsets.only(bottom: verticalScale(10)),
      child: Opacity(
        opacity: isDisabled && !isLoading ? 0.6 : 1,
        child: GestureDetector(
          key: const Key('google-login-button'),
          behavior: HitTestBehavior.opaque,
          onTap: disabled ? null : onPressed,
          child: Container(
            padding: EdgeInsets.symmetric(vertical: verticalScale(isLoading ? 10 : 11)),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(AppRadius.full),
              border: Border.all(color: AppColors.strokePrimary),
            ),
            alignment: Alignment.center,
            child: isLoading
                ? const Padding(
                    padding: EdgeInsets.symmetric(vertical: 2.5),
                    child: SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator.adaptive(valueColor: AlwaysStoppedAnimation(Colors.black)),
                    ),
                  )
                : Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      SvgPicture.asset('assets/icons/google.svg'),
                      const SizedBox(width: 8),
                      Text(
                        label,
                        style: const TextStyle(
                          fontFamily: AppFonts.robotoRegular,
                          fontSize: 14,
                          height: 22 / 14,
                          letterSpacing: 0.2,
                          color: Colors.black,
                        ),
                      ),
                    ],
                  ),
          ),
        ),
      ),
    );
  }
}

/// RN's `components/Button/AppleLoginButton`: the native black "Continue
/// with Apple" button (`AppleButton.Style.BLACK`, `Type.CONTINUE`), pill
/// corners, 46@vs tall; 60% opacity and untappable when disabled; a black
/// pill with a white spinner while loading.
class _AppleLoginButton extends StatelessWidget {
  const _AppleLoginButton({
    required this.label,
    required this.isLoading,
    required this.isDisabled,
    required this.onPressed,
    required this.height,
    required this.bottomMargin,
  });

  final String label;
  final bool isLoading;
  final bool isDisabled;
  final VoidCallback onPressed;
  final double height;
  final double bottomMargin;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: bottomMargin),
      child: isLoading
          ? Container(
              height: height,
              decoration: BoxDecoration(color: Colors.black, borderRadius: BorderRadius.circular(AppRadius.full)),
              alignment: Alignment.center,
              child: const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator.adaptive(valueColor: AlwaysStoppedAnimation(Colors.white)),
              ),
            )
          : Opacity(
              opacity: isDisabled ? 0.6 : 1,
              child: IgnorePointer(
                ignoring: isDisabled,
                child: SignInWithAppleButton(
                  key: const Key('apple-login-button'),
                  text: label,
                  height: height,
                  style: SignInWithAppleButtonStyle.black,
                  borderRadius: BorderRadius.circular(AppRadius.full),
                  onPressed: onPressed,
                ),
              ),
            ),
    );
  }
}
