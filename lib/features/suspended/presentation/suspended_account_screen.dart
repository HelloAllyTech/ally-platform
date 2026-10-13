import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/auth/auth_state.dart';

/// Port of ally-mobile (React Native)'s `SuspendedAccountScreen` — static
/// message + a button that signs out back to the login screen (the RN
/// version resets navigation to Splash; here, logging out triggers the
/// same router redirect to /login already built in Phase 0).
class SuspendedAccountScreen extends ConsumerWidget {
  const SuspendedAccountScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.block, size: 64, color: Colors.grey),
                const SizedBox(height: 16),
                Text(
                  'Your account has been suspended',
                  style: Theme.of(context).textTheme.titleLarge,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 8),
                const Text(
                  'Contact your administrator if you believe this is a mistake.',
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 32),
                FilledButton(
                  onPressed: () => ref.read(authControllerProvider.notifier).logout(),
                  child: const Text('Go to login'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
