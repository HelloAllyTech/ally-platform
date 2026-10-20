import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/app_dropdown.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../data/leaderboard_repository.dart';

/// Port of ally-mobile (React Native)'s `renderRankBadge` — the real
/// `rank1`/`rank2`/`rank3` gradient-medal SVGs for the top 3, a plain
/// neutral circle+number for everyone else (RN has no color coding past
/// 3rd place either).
class _RankBadge extends StatelessWidget {
  const _RankBadge({required this.rank});

  final int rank;

  static const _iconByRank = {
    1: 'assets/icons/rank1.svg',
    2: 'assets/icons/rank2.svg',
    3: 'assets/icons/rank3.svg',
  };

  @override
  Widget build(BuildContext context) {
    final icon = _iconByRank[rank];
    if (icon != null) {
      return SvgPicture.asset(icon, width: 28, height: 28);
    }
    return CircleAvatar(
      radius: 13,
      backgroundColor: AppColors.surfaceContainerHigh,
      // RN's styles.rankText: label.medium size, but IBM_PLEX_SERIF.MEDIUM
      // family — not labelMedium's Roboto-Regular default.
      child: Text(
        '$rank',
        style: Theme.of(context).textTheme.labelMedium?.copyWith(
              fontFamily: AppFonts.ibmPlexSerifMedium,
              color: AppColors.mediumEmphasis,
            ),
      ),
    );
  }
}

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
                          leading: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              _RankBadge(rank: entry.rank),
                              const SizedBox(width: 8),
                              CircleAvatar(
                                backgroundImage: entry.profileImageUrl.isNotEmpty
                                    ? NetworkImage(entry.profileImageUrl)
                                    : null,
                                child: entry.profileImageUrl.isEmpty
                                    ? Text(entry.name.isNotEmpty ? entry.name[0].toUpperCase() : '?')
                                    : null,
                              ),
                            ],
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
