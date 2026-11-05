import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

import 'package:ally_mobile_flutter/features/auth/presentation/login_screen.dart';

/// RN `useGoogleLogin` / `useAppleLogin` SDK-error toasts (ledger item 14).
void main() {
  group('googleSignInErrorToast', () {
    test('cancel is silent', () {
      const e = GoogleSignInException(code: GoogleSignInExceptionCode.canceled);
      expect(googleSignInErrorToast(e, fallback: 'fallback'), isNull);
    });

    test('Android provider unavailable is RN\'s Play Services message', () {
      const e = GoogleSignInException(code: GoogleSignInExceptionCode.providerConfigurationError);
      expect(
        googleSignInErrorToast(e, fallback: 'fallback', platform: TargetPlatform.android),
        'Google Play Services not available or outdated',
      );
    });

    test('other errors toast the SDK message, else the fallback', () {
      const withMessage = GoogleSignInException(
        code: GoogleSignInExceptionCode.unknownError,
        description: 'Network error',
      );
      expect(googleSignInErrorToast(withMessage, fallback: 'fallback', platform: TargetPlatform.iOS), 'Network error');
      const bare = GoogleSignInException(code: GoogleSignInExceptionCode.providerConfigurationError);
      expect(googleSignInErrorToast(bare, fallback: 'fallback', platform: TargetPlatform.iOS), 'fallback');
    });
  });

  group('appleSignInErrorToast', () {
    test('cancel is silent', () {
      const e = SignInWithAppleAuthorizationException(code: AuthorizationErrorCode.canceled, message: 'x');
      expect(appleSignInErrorToast(e, fallback: 'fallback'), isNull);
    });

    test('other errors toast the SDK message, else the fallback', () {
      const failed = SignInWithAppleAuthorizationException(code: AuthorizationErrorCode.failed, message: 'Auth failed');
      expect(appleSignInErrorToast(failed, fallback: 'fallback'), 'Auth failed');
      const empty = SignInWithAppleAuthorizationException(code: AuthorizationErrorCode.unknown, message: '');
      expect(appleSignInErrorToast(empty, fallback: 'fallback'), 'fallback');
    });
  });
}
