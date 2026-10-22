import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show TargetPlatform, defaultTargetPlatform;
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/auth/auth_state.dart';
import '../../../core/config/app_config.dart';
import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_text_field.dart';
import '../data/auth_repository.dart';
import 'terms_and_agreement_modal.dart';

// RN's src/constants/general.ts.
const _termsAndConditionsUrl = 'https://app.helloally.ai/terms';
const _privacyPolicyUrl = 'https://app.helloally.ai/privacy';
const _otpLength = 4;
const _resendCountdownSeconds = 60;
const _defaultOtpExpiryMinutes = 10;

/// RN's `isSuspendedUserError` (`src/utils/error.ts`) — a 403 whose body
/// carries `error: 'USER_SUSPENDED'` or the literal message `'User
/// suspended'`. Checked after every sign-in method (OTP, Google, Apple) so a
/// suspended account reaches SuspendedAccountScreen instead of a generic
/// "failed to verify OTP" error, same as RN's OtpVerification/useGoogleLogin/
/// useAppleLogin hooks.
bool _isSuspendedUserError(Object error) {
  if (error is! DioException) return false;
  if (error.response?.statusCode != 403) return false;
  final data = error.response?.data;
  if (data is! Map) return false;
  return data['error'] == 'USER_SUSPENDED' || data['message'] == 'User suspended';
}

/// Real email+OTP, Google, and Apple sign-in, matching ally-mobile (React
/// Native)'s `generateOtp`/`verifyOtp`/`loginWithGoogle`/`loginWithApple`
/// contracts (`useGoogleLogin`/`useAppleLogin` hooks). Google/Apple can't
/// complete a real round-trip until this app's own distinct package name
/// has an OAuth client registered — see auth_repository.dart's doc comment
/// — so those buttons disable themselves (Google) or surface the backend's
/// real rejection (Apple, which has no equivalent "is configured" check
/// client-side) rather than pretending to work.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

enum _Step { email, otp }

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _emailController = TextEditingController();
  final _otpControllers = List.generate(_otpLength, (_) => TextEditingController());
  final _otpFocusNodes = List.generate(_otpLength, (_) => FocusNode());
  _Step _step = _Step.email;
  bool _isSubmitting = false;
  bool _isResending = false;
  String? _error;
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
    // Rebuilds the Verify button's enabled state as digits fill in.
    for (final controller in _otpControllers) {
      controller.addListener(_onOtpDigitsChanged);
    }
  }

  @override
  void dispose() {
    _emailController.dispose();
    for (final controller in _otpControllers) {
      controller.dispose();
    }
    for (final node in _otpFocusNodes) {
      node.dispose();
    }
    _resendTimer?.cancel();
    super.dispose();
  }

  void _onOtpDigitsChanged() => setState(() {});

  bool get _isOtpComplete => _otpControllers.every((c) => c.text.isNotEmpty);

  void _startResendCountdown(int? expiresInSeconds) {
    _resendTimer?.cancel();
    setState(() {
      _resendCountdown = _resendCountdownSeconds;
      _otpExpiryMinutes =
          expiresInSeconds != null ? (expiresInSeconds / 60).ceil() : _defaultOtpExpiryMinutes;
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

  Future<void> _signInWithGoogle() async {
    final initFuture = _googleInitFuture;
    if (initFuture == null) {
      setState(() => _error = 'Google sign-in isn\'t configured for this build.');
      return;
    }
    setState(() {
      _isSubmitting = true;
      _error = null;
    });
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
      final (accessToken, refreshToken) =
          await ref.read(authRepositoryProvider).loginWithGoogle(idToken);
      if (!mounted) return;
      await TermsAndAgreementModal.show(context);
      await ref.read(authControllerProvider.notifier).signIn(
            accessToken: accessToken,
            refreshToken: refreshToken,
          );
    } on GoogleSignInException catch (e) {
      if (e.code != GoogleSignInExceptionCode.canceled) {
        setState(() => _error = '${ref.tr('auth.login.google.error')}: ${e.description ?? e.code}');
      }
    } catch (e) {
      if (_isSuspendedUserError(e)) {
        if (mounted) context.push('/suspended');
      } else {
        setState(() => _error = '${ref.tr('auth.login.google.error')}: $e');
      }
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  Future<void> _signInWithApple() async {
    setState(() {
      _isSubmitting = true;
      _error = null;
    });
    try {
      final credential = await SignInWithApple.getAppleIDCredential(
        scopes: [AppleIDAuthorizationScopes.email, AppleIDAuthorizationScopes.fullName],
      );
      final identityToken = credential.identityToken;
      if (identityToken == null) {
        throw StateError('No identity token returned from Apple');
      }
      final (accessToken, refreshToken) = await ref.read(authRepositoryProvider).loginWithApple(
            identityToken: identityToken,
            authorizationCode: credential.authorizationCode,
            givenName: credential.givenName,
            familyName: credential.familyName,
          );
      if (!mounted) return;
      await TermsAndAgreementModal.show(context);
      await ref.read(authControllerProvider.notifier).signIn(
            accessToken: accessToken,
            refreshToken: refreshToken,
          );
    } on SignInWithAppleAuthorizationException catch (e) {
      if (e.code != AuthorizationErrorCode.canceled) {
        setState(() => _error = '${ref.tr('auth.login.apple.error')}: ${e.message}');
      }
    } catch (e) {
      if (_isSuspendedUserError(e)) {
        if (mounted) context.push('/suspended');
      } else {
        setState(() => _error = '${ref.tr('auth.login.apple.error')}: $e');
      }
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  Future<void> _sendCode() async {
    final email = _emailController.text.trim();
    if (email.isEmpty) {
      setState(() => _error = ref.tr('auth.login.email.error'));
      return;
    }
    setState(() {
      _isSubmitting = true;
      _error = null;
    });
    try {
      final expiresIn = await ref.read(authRepositoryProvider).generateOtp(email);
      if (!mounted) return;
      setState(() => _step = _Step.otp);
      _startResendCountdown(expiresIn);
    } catch (e) {
      setState(() => _error = '${ref.tr('auth.login.errors.generateOtp')}: $e');
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  Future<void> _resendOtp() async {
    setState(() => _isResending = true);
    try {
      final expiresIn =
          await ref.read(authRepositoryProvider).generateOtp(_emailController.text.trim());
      if (!mounted) return;
      for (final controller in _otpControllers) {
        controller.clear();
      }
      setState(() => _error = null);
      _startResendCountdown(expiresIn);
      _otpFocusNodes.first.requestFocus();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('${ref.tr('auth.login.errors.generateOtp')}: $e')));
      }
    } finally {
      if (mounted) setState(() => _isResending = false);
    }
  }

  Future<void> _verifyCode() async {
    final otp = _otpControllers.map((c) => c.text).join();
    if (otp.isEmpty) {
      setState(() => _error = ref.tr('auth.login.otp.emptyCodeError'));
      return;
    }
    setState(() {
      _isSubmitting = true;
      _error = null;
    });
    try {
      final (accessToken, refreshToken) = await ref.read(authRepositoryProvider).verifyOtp(
            email: _emailController.text.trim(),
            otp: otp,
          );
      if (!mounted) return;
      await TermsAndAgreementModal.show(context);
      await ref.read(authControllerProvider.notifier).signIn(
            accessToken: accessToken,
            refreshToken: refreshToken,
          );
    } catch (e) {
      if (_isSuspendedUserError(e)) {
        if (mounted) context.push('/suspended');
      } else {
        setState(() => _error = '${ref.tr('auth.login.errors.verifyOtp')}: $e');
      }
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      // RN wraps this whole screen in a `KeyboardAwareScrollView` — the
      // OTP/email forms plus the new subtitle/footer text can exceed a
      // short screen's height (confirmed: a plain Center+Column overflowed
      // once this content was added), and the content starts from the top
      // in the real app rather than being vertically centered regardless.
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _buildGreeting(context),
              const SizedBox(height: 24),
              if (_step == _Step.email) ...[
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text(ref.t('auth.login.subtitle')),
                ),
                const SizedBox(height: 16),
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text(ref.t('auth.login.email.label'), style: Theme.of(context).textTheme.labelLarge),
                ),
                const SizedBox(height: 8),
                AppTextField(
                  controller: _emailController,
                  keyboardType: TextInputType.emailAddress,
                ),
                const SizedBox(height: 16),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(_error!, style: const TextStyle(color: AppColors.red400)),
                  ),
                AppButton(
                  label: ref.t('common.next'),
                  onPressed: _sendCode,
                  isLoading: _isSubmitting,
                ),
                const SizedBox(height: 24),
                Row(
                  children: [
                    const Expanded(child: Divider()),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      child: Text(ref.t('common.or')),
                    ),
                    const Expanded(child: Divider()),
                  ],
                ),
                const SizedBox(height: 16),
                OutlinedButton.icon(
                  onPressed: (_isSubmitting || _googleInitFuture == null) ? null : _signInWithGoogle,
                  icon: SvgPicture.asset('assets/icons/google.svg', width: 18, height: 18),
                  label: Text(ref.t('auth.login.google.button')),
                ),
                if (defaultTargetPlatform == TargetPlatform.iOS) ...[
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: _isSubmitting ? null : _signInWithApple,
                    icon: const Icon(Icons.apple),
                    label: Text(ref.t('auth.login.apple.button')),
                  ),
                ],
                const SizedBox(height: 24),
                _buildTermsFooter(context),
              ] else ...[
                // RN's headerText/emailText: same size, different family —
                // not one flat "enter code <email>" line.
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text.rich(
                    TextSpan(
                      children: [
                        TextSpan(
                          text: ref.t('auth.login.otp.enterCode'),
                          style: const TextStyle(fontFamily: AppFonts.replayProHeadline, fontSize: 20),
                        ),
                        const TextSpan(text: '\n'),
                        TextSpan(
                          text: _emailController.text.trim(),
                          style: const TextStyle(fontFamily: AppFonts.ibmPlexSerifRegular, fontSize: 20),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 24),
                _buildOtpBoxes(context),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 16),
                    child: Text(_error!, style: const TextStyle(color: AppColors.red400)),
                  ),
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerLeft,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        ref.t('auth.login.otp.expires', {'minutes': _otpExpiryMinutes}),
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      TextButton(
                        onPressed: (_resendCountdown > 0 || _isResending) ? null : _resendOtp,
                        style: TextButton.styleFrom(
                          padding: EdgeInsets.zero,
                          minimumSize: Size.zero,
                          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          alignment: Alignment.centerLeft,
                        ),
                        child: Text(
                          _resendCountdown > 0
                              ? '${ref.t('auth.login.otp.resend')} (${_resendCountdown}s)'
                              : ref.t('auth.login.otp.resend'),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                AppButton(
                  label: ref.t('auth.login.otp.verify'),
                  onPressed: _verifyCode,
                  isLoading: _isSubmitting,
                  isDisabled: !_isOtpComplete,
                ),
                TextButton(
                  onPressed: () => setState(() => _step = _Step.email),
                  child: Text(ref.t('auth.login.otp.useDifferentEmail')),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  /// RN's `OtpInput` — four boxed, individually-focused digit fields with
  /// auto-advance on entry, backspace-to-previous when the current box is
  /// already empty, and a paste shortcut (typing/pasting multiple digits
  /// into the first box fills the rest). Previously this was one plain
  /// `AppTextField` taking the whole code as free text.
  Widget _buildOtpBoxes(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        for (var index = 0; index < _otpLength; index++)
          SizedBox(
            width: 60,
            height: 60,
            // Backspace on an already-empty box has nothing to delete, so
            // `TextField`'s own handling leaves it unhandled and it bubbles
            // up here — that's when it moves focus back a box.
            child: Focus(
              onKeyEvent: (node, event) {
                if (event is KeyDownEvent &&
                    event.logicalKey == LogicalKeyboardKey.backspace &&
                    _otpControllers[index].text.isEmpty &&
                    index > 0) {
                  _otpControllers[index - 1].clear();
                  _otpFocusNodes[index - 1].requestFocus();
                  return KeyEventResult.handled;
                }
                return KeyEventResult.ignored;
              },
              child: TextField(
                controller: _otpControllers[index],
                focusNode: _otpFocusNodes[index],
                textAlign: TextAlign.center,
                keyboardType: TextInputType.number,
                maxLength: index == 0 ? _otpLength : 1,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w600),
                decoration: InputDecoration(
                  counterText: '',
                  filled: true,
                  fillColor: const Color(0xFFF5F5F5),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide(
                      color: _error != null ? AppColors.red400 : AppColors.lightGray2,
                    ),
                  ),
                ),
                onChanged: (value) => _handleOtpDigitChanged(value, index),
              ),
            ),
          ),
      ],
    );
  }

  void _handleOtpDigitChanged(String value, int index) {
    if (value.length > 1) {
      // A paste landed in one box — spread its digits across the rest.
      for (var i = 0; i < _otpLength; i++) {
        _otpControllers[i].text = i < value.length ? value[i] : '';
      }
      final lastFilled = value.length.clamp(0, _otpLength) - 1;
      if (lastFilled >= 0) _otpFocusNodes[lastFilled].requestFocus();
      return;
    }
    if (value.isNotEmpty && index < _otpLength - 1) {
      _otpFocusNodes[index + 1].requestFocus();
    }
  }

  /// RN's SplashScreen shows a different greeting per step: on the email
  /// step, "Hey," then "Welcome to Ally" (both ReplayPro-Headline, except
  /// "Ally" itself, in its bespoke `allyText` style, YESEVA_ONE.REGULAR);
  /// on the OTP step, a single unrelated line ("Verify your email address"),
  /// no "Ally" wordmark at all. Previously this always showed bare "Ally",
  /// on both steps, which is neither of RN's two real greetings.
  Widget _buildGreeting(BuildContext context) {
    final titleStyle = Theme.of(context).textTheme.displayMedium;
    if (_step == _Step.otp) {
      return Text(ref.t('auth.login.otp.title'), style: titleStyle);
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(ref.t('auth.login.greetingLine1'), style: titleStyle),
        Text.rich(
          TextSpan(
            style: titleStyle,
            children: [
              TextSpan(text: '${ref.t('auth.login.welcome')} '),
              TextSpan(
                text: ref.t('common.appName'),
                style: TextStyle(fontFamily: AppFonts.yesevaOneRegular),
              ),
            ],
          ),
        ),
      ],
    );
  }

  /// RN's EmailLogin footer: "By proceeding, i agree to Ally's **Terms &
  /// Conditions** and acknowledge **Privacy Policy.**." — yes, a double
  /// period: `auth.login.privacy` already ends in one, and the JSX appends
  /// a literal `.` after it regardless. Reproduced exactly rather than
  /// "corrected", since that's what actually ships.
  Widget _buildTermsFooter(BuildContext context) {
    final linkStyle = const TextStyle(decoration: TextDecoration.underline);
    return Text.rich(
      TextSpan(
        style: Theme.of(context).textTheme.bodySmall,
        children: [
          TextSpan(text: '${ref.t('auth.login.proceedAgree')} '),
          TextSpan(
            text: ref.t('auth.login.terms'),
            style: linkStyle,
            recognizer: TapGestureRecognizer()
              ..onTap = () => launchUrl(
                    Uri.parse(_termsAndConditionsUrl),
                    mode: LaunchMode.externalApplication,
                  ),
          ),
          TextSpan(text: ' ${ref.t('auth.login.and')} '),
          TextSpan(
            text: ref.t('auth.login.privacy'),
            style: linkStyle,
            recognizer: TapGestureRecognizer()
              ..onTap = () => launchUrl(
                    Uri.parse(_privacyPolicyUrl),
                    mode: LaunchMode.externalApplication,
                  ),
          ),
          const TextSpan(text: '.'),
        ],
      ),
      textAlign: TextAlign.center,
    );
  }
}
