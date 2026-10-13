import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/auth/auth_state.dart';

/// Placeholder landing screen post-login. Real content (courses, Scribe,
/// simulations tabs) is what Phases 2-4 of the migration plan actually
/// build. For now it's also the dev entry point into the two Phase 1
/// screens (Scribe recording, roleplay voice) since there's no real
/// navigation flow to them yet.
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
            FilledButton(
              onPressed: () => context.push('/courses'),
              child: const Text('Phase 2: Courses'),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => context.push('/profile'),
              child: const Text('Phase 2: Profile'),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => context.push('/notifications'),
              child: const Text('Phase 2: Notifications'),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => context.push('/simulations'),
              child: const Text('Phase 3: Simulations'),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => context.push('/leaderboard'),
              child: const Text('Phase 4: Leaderboard'),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => context.push('/achievements'),
              child: const Text('Phase 4: Achievements'),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => context.push('/bug-report'),
              child: const Text('Phase 4: Report a bug'),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => context.push('/search'),
              child: const Text('Phase 4: Search'),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => context.push('/reviews'),
              child: const Text('Phase 4: Reviews'),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => context.push('/call-log'),
              child: const Text('Phase 4: Call log'),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => context.push('/community'),
              child: const Text('Phase 4: Community'),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => context.push('/box-breathing'),
              child: const Text('Phase 4: Box breathing'),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => context.push('/cases'),
              child: const Text('Phase 4: Cases'),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => context.push('/scribe'),
              child: const Text('Phase 1: Scribe recording'),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => context.push(
                '/roleplay',
                extra: const <String, String>{},
              ),
              child: const Text('Phase 1: Roleplay voice'),
            ),
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
