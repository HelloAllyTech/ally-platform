import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/widgets/app_dropdown.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../data/leaderboard_repository.dart';

/// Port of ally-mobile (React Native)'s `LeaderboardScreen` — ranked list,
/// the current user's own rank pinned at top, and the same window-period
/// dropdown (last 7/28/364 days, all time; defaults to last 7 days).
class LeaderboardScreen extends ConsumerWidget {
  const LeaderboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final leaderboardAsync = ref.watch(leaderboardProvider);
    final myRankAsync = ref.watch(myRankProvider);
    final selectedWindow = ref.watch(leaderboardWindowProvider);

    return Scaffold(
      body: Column(
        children: [
          TabScreenHeader(
            title: ref.t('community.title'),
            trailing: SizedBox(
              width: 160,
              child: AppDropdown(
                value: selectedWindow.label,
                options: [for (final window in LeaderboardWindow.values) window.label],
                onSelect: (label) {
                  final window = LeaderboardWindow.values.firstWhere((w) => w.label == label);
                  ref.read(leaderboardWindowProvider.notifier).select(window);
                },
              ),
            ),
          ),
          Expanded(
            child: leaderboardAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, _) => Center(child: Text('${ref.t('community.loadError')}: $error')),
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
                              title: Text(ref.t('community.yourRank')),
                              subtitle: Text(
                                '${myRank.minutesPlayed} ${ref.t('community.duration.minute')} · '
                                '${myRank.badgeCount} ${ref.t('community.table.badges')}',
                              ),
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
                          trailing:
                              Text('${entry.minutesPlayed} ${ref.t('community.duration.minute')}'),
                        );
                      },
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
