import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/auth/auth_state.dart';

/// Placeholder landing screen post-login. Real content (courses, Scribe,
/// simulations tabs) is what Phases 2-4 of the migration plan actually
/// build — this exists only so the router shell has somewhere authenticated
/// to land, and so the logout path is exercisable end-to-end.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: const Text('Ally')),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Phase 0 shell — authenticated.'),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: () => ref.read(authControllerProvider.notifier).logout(),
              child: const Text('Log out'),
            ),
          ],
        ),
      ),
    );
  }
}
