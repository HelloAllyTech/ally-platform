import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/auth/auth_state.dart';
import '../data/account_repository.dart';

/// Scoped port of ally-mobile (React Native)'s `ProfileSettingsScreen` —
/// shows the real profile (GET /users/me) and the sign-out action. Profile
/// image upload/edit and the preferences screen (`userApi.ts`'s
/// get/updateUserPreferences) are not ported yet.
class ProfileSettingsScreen extends ConsumerWidget {
  const ProfileSettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final userAsync = ref.watch(currentUserProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: userAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(child: Text('Failed to load profile: $error')),
        data: (user) => ListView(
          padding: const EdgeInsets.all(24),
          children: [
            CircleAvatar(
              radius: 40,
              backgroundImage: user.profileImageUrl != null
                  ? NetworkImage(user.profileImageUrl!)
                  : null,
              child: user.profileImageUrl == null
                  ? Text(user.name.isNotEmpty ? user.name[0].toUpperCase() : '?')
                  : null,
            ),
            const SizedBox(height: 16),
            Center(
              child: Text(
                user.name.isNotEmpty ? user.name : '(name not set)',
                style: Theme.of(context).textTheme.titleLarge,
              ),
            ),
            Center(child: Text(user.email)),
            if (user.phone.isNotEmpty) Center(child: Text(user.phone)),
            const SizedBox(height: 32),
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
