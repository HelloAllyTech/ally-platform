import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/auth/auth_state.dart';

/// Placeholder login screen — Phase 0 scope is the auth *flow shell*
/// (navigation redirect on auth state, token storage, the Dio refresh
/// interceptor), not the real Google/Apple sign-in buttons or OTP form yet.
/// Those port from `src/screens/SplashScreen/components/EmailLogin` and
/// `OtpVerification` in a later phase, once `google_sign_in`/
/// `sign_in_with_apple` are wired to the real backend contract.
class LoginScreen extends ConsumerWidget {
  const LoginScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Ally',
                style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              const Text(
                'Sign-in flow not yet ported — this screen only proves the '
                'auth-state → router redirect works.',
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 24),
              FilledButton(
                onPressed: () => ref.read(authControllerProvider.notifier).signIn(
                      accessToken: 'dev-placeholder-access-token',
                      refreshToken: 'dev-placeholder-refresh-token',
                    ),
                child: const Text('Simulate sign-in (dev only)'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
