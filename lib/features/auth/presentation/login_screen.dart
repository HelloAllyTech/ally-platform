import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/auth/auth_state.dart';
import '../data/auth_repository.dart';

/// Real email+OTP sign-in, matching ally-mobile (React Native)'s
/// `generateOtp`/`verifyOtp` contract exactly. Google/Apple sign-in aren't
/// ported — see auth_repository.dart's doc comment for why (native OAuth
/// client setup this app's distinct package name doesn't have yet).
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

  @override
  void dispose() {
    _emailController.dispose();
    _otpController.dispose();
    super.dispose();
  }

  Future<void> _sendCode() async {
    final email = _emailController.text.trim();
    if (email.isEmpty) {
      setState(() => _error = 'Enter your email.');
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
      setState(() => _error = 'Failed to send code: $e');
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  Future<void> _verifyCode() async {
    final otp = _otpController.text.trim();
    if (otp.isEmpty) {
      setState(() => _error = 'Enter the code.');
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
      await ref.read(authControllerProvider.notifier).signIn(
            accessToken: accessToken,
            refreshToken: refreshToken,
          );
    } catch (e) {
      setState(() => _error = 'Invalid code: $e');
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
              const Text('Ally', style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold)),
              const SizedBox(height: 24),
              if (_step == _Step.email) ...[
                TextField(
                  controller: _emailController,
                  keyboardType: TextInputType.emailAddress,
                  decoration: const InputDecoration(labelText: 'Email', border: OutlineInputBorder()),
                ),
                const SizedBox(height: 16),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(_error!, style: const TextStyle(color: Colors.red)),
                  ),
                FilledButton(
                  onPressed: _isSubmitting ? null : _sendCode,
                  child: _isSubmitting
                      ? const SizedBox(
                          width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Text('Send code'),
                ),
              ] else ...[
                Text('Enter the code sent to ${_emailController.text.trim()}'),
                const SizedBox(height: 16),
                TextField(
                  controller: _otpController,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'Code', border: OutlineInputBorder()),
                ),
                const SizedBox(height: 16),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(_error!, style: const TextStyle(color: Colors.red)),
                  ),
                FilledButton(
                  onPressed: _isSubmitting ? null : _verifyCode,
                  child: _isSubmitting
                      ? const SizedBox(
                          width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Text('Verify'),
                ),
                TextButton(
                  onPressed: () => setState(() => _step = _Step.email),
                  child: const Text('Use a different email'),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
