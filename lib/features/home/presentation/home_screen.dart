import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/auth/auth_state.dart';
import '../../../core/localization/translate_ref.dart';
import '../../../core/push/push_notification_service.dart';
import '../../notifications/data/notifications_repository.dart';

/// Placeholder landing screen post-login. Real content (courses, Scribe,
/// simulations tabs) is what Phases 2-4 of the migration plan actually
/// build. For now it's also the dev entry point into the two Phase 1
/// screens (Scribe recording, roleplay voice) since there's no real
/// navigation flow to them yet.
///
/// Also where push-notification device-token registration fires — once per
/// "landed on Home authenticated" rather than scattered across every screen
/// that could be the first one after sign-in.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  @override
  void initState() {
    super.initState();
    ref
        .read(pushNotificationServiceProvider)
        .initializeAndRegister(ref.read(notificationsRepositoryProvider));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(ref.t('common.appName'))),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(ref.t('home.phase0Shell')),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () => context.push('/courses'),
              child: Text(ref.t('home.courses')),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => context.push('/profile'),
              child: Text(ref.t('home.profile')),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => context.push('/notifications'),
              child: Text(ref.t('home.notifications')),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => context.push('/simulations'),
              child: Text(ref.t('home.simulations')),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => context.push('/leaderboard'),
              child: Text(ref.t('home.leaderboard')),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => context.push('/achievements'),
              child: Text(ref.t('home.achievements')),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => context.push('/bug-report'),
              child: Text(ref.t('home.bugReport')),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => context.push('/search'),
              child: Text(ref.t('home.search')),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => context.push('/reviews'),
              child: Text(ref.t('home.reviews')),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => context.push('/call-log'),
              child: Text(ref.t('home.callLog')),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => context.push('/community'),
              child: Text(ref.t('home.community')),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => context.push('/box-breathing'),
              child: Text(ref.t('home.boxBreathing')),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => context.push('/cases'),
              child: Text(ref.t('home.cases')),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => context.push('/scribe'),
              child: Text(ref.t('home.scribe')),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => context.push(
                '/roleplay',
                extra: const <String, String>{},
              ),
              child: Text(ref.t('home.roleplay')),
            ),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: () => ref.read(authControllerProvider.notifier).logout(),
              child: Text(ref.t('user.logout')),
            ),
          ],
        ),
      ),
    );
  }
}
