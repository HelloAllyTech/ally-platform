import 'package:flutter/foundation.dart' show TargetPlatform, defaultTargetPlatform;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

import '../../../core/auth/auth_state.dart';
import '../../../core/config/app_config.dart';
import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_text_field.dart';
import '../data/auth_repository.dart';
import 'terms_and_agreement_modal.dart';

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
  final _otpController = TextEditingController();
  _Step _step = _Step.email;
  bool _isSubmitting = false;
  String? _error;

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
  }

  @override
  void dispose() {
    _emailController.dispose();
    _otpController.dispose();
    super.dispose();
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
      setState(() => _error = '${ref.tr('auth.login.google.error')}: $e');
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
      setState(() => _error = '${ref.tr('auth.login.apple.error')}: $e');
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
      await ref.read(authRepositoryProvider).generateOtp(email);
      setState(() => _step = _Step.otp);
    } catch (e) {
      setState(() => _error = '${ref.tr('auth.login.errors.generateOtp')}: $e');
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  Future<void> _verifyCode() async {
    final otp = _otpController.text.trim();
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
      setState(() => _error = '${ref.tr('auth.login.errors.verifyOtp')}: $e');
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _buildGreeting(context),
              const SizedBox(height: 24),
              if (_step == _Step.email) ...[
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
                  icon: const Icon(Icons.g_mobiledata),
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
              ] else ...[
                Text('${ref.t('auth.login.otp.enterCode')} ${_emailController.text.trim()}'),
                const SizedBox(height: 16),
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text('Code', style: Theme.of(context).textTheme.labelLarge),
                ),
                const SizedBox(height: 8),
                AppTextField(
                  controller: _otpController,
                  keyboardType: TextInputType.number,
                ),
                const SizedBox(height: 16),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(_error!, style: const TextStyle(color: AppColors.red400)),
                  ),
                AppButton(
                  label: ref.t('auth.login.otp.verify'),
                  onPressed: _verifyCode,
                  isLoading: _isSubmitting,
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
}
