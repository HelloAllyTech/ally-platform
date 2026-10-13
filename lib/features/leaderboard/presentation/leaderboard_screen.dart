import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/leaderboard_repository.dart';

/// Port of ally-mobile (React Native)'s `LeaderboardScreen` — ranked list +
/// the current user's own rank pinned at top. Window-period filtering
/// (weekly/monthly/all-time toggle, if the RN screen has one) not ported.
class LeaderboardScreen extends ConsumerWidget {
  const LeaderboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final leaderboardAsync = ref.watch(leaderboardProvider);
    final myRankAsync = ref.watch(myRankProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Leaderboard')),
      body: leaderboardAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(child: Text('Failed to load leaderboard: $error')),
        data: (entries) => Column(
          children: [
            myRankAsync.maybeWhen(
              data: (myRank) => myRank == null
                  ? const SizedBox.shrink()
                  : Card(
                      margin: const EdgeInsets.all(12),
                      color: Theme.of(context).colorScheme.primaryContainer,
                      child: ListTile(
                        leading: CircleAvatar(child: Text('${myRank.rank}')),
                        title: const Text('Your rank'),
                        subtitle: Text('${myRank.minutesPlayed} min · ${myRank.badgeCount} badges'),
                      ),
                    ),
              orElse: () => const SizedBox.shrink(),
            ),
            Expanded(
              child: ListView.builder(
                itemCount: entries.length,
                itemBuilder: (context, index) {
                  final entry = entries[index];
                  return ListTile(
                    leading: CircleAvatar(
                      backgroundImage: entry.profileImageUrl.isNotEmpty
                          ? NetworkImage(entry.profileImageUrl)
                          : null,
                      child: entry.profileImageUrl.isEmpty
                          ? Text('${entry.rank}')
                          : null,
                    ),
                    title: Text(entry.name),
                    trailing: Text('${entry.minutesPlayed} min'),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
