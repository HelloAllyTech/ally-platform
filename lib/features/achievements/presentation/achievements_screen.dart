import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/achievements_repository.dart';

/// Port of ally-mobile (React Native)'s `AchievementsScreen` — badges
/// grouped by category, locked/unlocked state. Tap-to-mark-viewed is wired;
/// the RN screen's unlock-celebration animation is not ported.
class AchievementsScreen extends ConsumerWidget {
  const AchievementsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final badgesAsync = ref.watch(badgesProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Achievements')),
      body: badgesAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(child: Text('Failed to load achievements: $error')),
        data: (groups) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            for (final group in groups) ...[
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text(group.category, style: Theme.of(context).textTheme.titleMedium),
              ),
              GridView.count(
                crossAxisCount: 3,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                children: [
                  for (final badge in group.badges)
                    GestureDetector(
                      onTap: () => ref
                          .read(achievementsRepositoryProvider)
                          .markBadgeAsViewed(badge.id),
                      child: Opacity(
                        opacity: badge.lockStatus == BadgeLockStatus.unlocked ? 1 : 0.35,
                        child: Column(
                          children: [
                            CircleAvatar(
                              radius: 28,
                              backgroundImage:
                                  badge.imageUrl.isNotEmpty ? NetworkImage(badge.imageUrl) : null,
                              child: badge.imageUrl.isEmpty
                                  ? Icon(
                                      badge.lockStatus == BadgeLockStatus.unlocked
                                          ? Icons.emoji_events
                                          : Icons.lock_outline,
                                    )
                                  : null,
                            ),
                            const SizedBox(height: 4),
                            Text(
                              badge.name,
                              textAlign: TextAlign.center,
                              style: const TextStyle(fontSize: 11),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}
