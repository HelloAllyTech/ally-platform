import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/app_dropdown.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../data/leaderboard_repository.dart';

/// Mirrors ally-mobile (React Native)'s `formatMinutesToDuration` exactly —
/// including its hardcoded, un-translated "h"/"min" literals (that util
/// never calls `t()`, so RN shows this in English regardless of locale).
String _formatDuration(int minutes) {
  final hours = minutes ~/ 60;
  final remainingMinutes = minutes % 60;
  if (hours > 0 && remainingMinutes > 0) {
    return '$hours h $remainingMinutes min';
  }
  if (hours > 0) return '$hours h';
  return '$remainingMinutes min';
}

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

/// Fixed row height used for the sticky-footer scroll math below. RN
/// measures the real row height at runtime via `onLayout`; a fixed value is
/// an acceptable simplification since every row renders the same layout.
const double _kRowHeight = 64;

/// Port of ally-mobile (React Native)'s `LeaderboardScreen` — ranked list
/// with pull-to-refresh, infinite-scroll pagination, the current user's row
/// inline-highlighted in place (not a separate card), and RN's own
/// conditional sticky footer (shown only while the current user's row is
/// still below the visible viewport).
class LeaderboardScreen extends ConsumerStatefulWidget {
  const LeaderboardScreen({super.key});

  @override
  ConsumerState<LeaderboardScreen> createState() => _LeaderboardScreenState();
}

class _LeaderboardScreenState extends ConsumerState<LeaderboardScreen> {
  final _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 200) {
      ref.read(leaderboardControllerProvider.notifier).loadMore();
    }
  }

  Widget _row({
    required BuildContext context,
    required LeaderboardEntry entry,
    required bool showRankColumn,
    required bool isHighlighted,
  }) {
    // An explicit Row with the same column widths _TableHeaderRow uses
    // (rank 32+8, duration 90, gap 16, badges 50), not a ListTile — a
    // ListTile's leading/title/trailing sizing is content-driven and
    // doesn't guarantee the data actually lines up under the header's
    // fixed column boundaries above it.
    return Container(
      height: _kRowHeight,
      margin: isHighlighted ? const EdgeInsets.symmetric(horizontal: 8) : null,
      decoration: isHighlighted
          ? BoxDecoration(
              color: AppColors.blue50,
              border: Border.all(color: AppColors.primary, width: 0.5),
              borderRadius: BorderRadius.circular(8),
            )
          : null,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        children: [
          if (showRankColumn) ...[
            SizedBox(width: 32, child: _RankBadge(rank: entry.rank)),
            const SizedBox(width: 8),
          ],
          CircleAvatar(
            backgroundImage: entry.profileImageUrl.isNotEmpty
                ? NetworkImage(entry.profileImageUrl)
                : null,
            child: entry.profileImageUrl.isEmpty
                ? Text(entry.name.isNotEmpty ? entry.name[0].toUpperCase() : '?')
                : null,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(entry.name, maxLines: 1, overflow: TextOverflow.ellipsis),
          ),
          SizedBox(
            width: 90,
            child: Text(
              _formatDuration(entry.minutesPlayed),
              textAlign: TextAlign.right,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: 16),
          SizedBox(
            width: 50,
            child: Row(
              children: [
                SvgPicture.asset('assets/icons/badgeIcon.svg', width: 14, height: 14),
                const SizedBox(width: 4),
                Expanded(
                  child: Text(
                    '${entry.badgeCount}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final pageAsync = ref.watch(leaderboardControllerProvider);
    final myRankAsync = ref.watch(myRankProvider);
    final selectedWindow = ref.watch(leaderboardWindowProvider);

    final myRank = myRankAsync.value;
    final myBadgeCount = myRank?.badgeCount ?? 0;
    // RN: `showRankColumn = !currentUserEntry?.hideRankInCommunity` — true
    // (shown) until myRank is known to say otherwise.
    final showRankColumn = !(myRank?.hideRankInCommunity ?? false);

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            TabScreenHeader(
              title: ref.t('community.title'),
              tooltip:
                  '${ref.t('community.title')}\n${ref.t('achievements.badgeTooltipDescription')}',
              trailing: TextButton.icon(
                onPressed: () => context.push('/achievements'),
                icon: SvgPicture.asset(
                  'assets/icons/badgeIcon.svg',
                  width: 20,
                  height: 20,
                ),
                label: Text('$myBadgeCount ${ref.t('community.table.badges')}'),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
              child: Align(
                alignment: Alignment.centerRight,
                child: SizedBox(
                  width: 160,
                  child: AppDropdown(
                    // RN's `getPeriodLabel` (`LeaderboardScreen.tsx`)
                    // translates this dropdown via `t()` — it was rendering
                    // the enum's bare English `label` verbatim, the one
                    // untranslated spot on an otherwise fully-localized
                    // screen, even though `community.filters.*` already has
                    // real translations in every locale file.
                    value: ref.t(selectedWindow.labelKey),
                    options: [
                      for (final window in LeaderboardWindow.values)
                        ref.t(window.labelKey),
                    ],
                    onSelect: (label) {
                      final window = LeaderboardWindow.values.firstWhere(
                        (w) => ref.t(w.labelKey) == label,
                      );
                      ref
                          .read(leaderboardWindowProvider.notifier)
                          .select(window);
                    },
                  ),
                ),
              ),
            ),
            _TableHeaderRow(showRankColumn: showRankColumn),
            Expanded(
              child: pageAsync.when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (error, _) => Center(
                  child: Text('${ref.t('community.loadError')}: $error'),
                ),
                data: (page) {
                  if (page.items.isEmpty) {
                    return Center(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 32),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              ref.t('community.emptyLeaderboard'),
                              style: Theme.of(context).textTheme.titleMedium,
                              textAlign: TextAlign.center,
                            ),
                            const SizedBox(height: 8),
                            Text(
                              ref.t('community.emptyLeaderBoardDescription'),
                              style: Theme.of(context).textTheme.bodyMedium,
                              textAlign: TextAlign.center,
                            ),
                          ],
                        ),
                      ),
                    );
                  }

                  final currentUserIndex = myRank == null
                      ? -1
                      : page.items.indexWhere((e) => e.userId == myRank.userId);

                  return Stack(
                    children: [
                      RefreshIndicator(
                        onRefresh: () =>
                            ref.refresh(leaderboardControllerProvider.future),
                        child: ListView.separated(
                          controller: _scrollController,
                          itemCount:
                              page.items.length + (page.isLoadingMore ? 1 : 0),
                          separatorBuilder: (_, _) => const Divider(height: 1),
                          itemBuilder: (context, index) {
                            if (index >= page.items.length) {
                              return const Padding(
                                padding: EdgeInsets.symmetric(vertical: 16),
                                child: Center(
                                  child: CircularProgressIndicator(),
                                ),
                              );
                            }
                            return _row(
                              context: context,
                              entry: page.items[index],
                              showRankColumn: showRankColumn,
                              isHighlighted: index == currentUserIndex,
                            );
                          },
                        ),
                      ),
                      // RN's sticky footer: pinned current-user row, shown only
                      // while that row's position is still below the visible
                      // viewport (not yet scrolled to) — never when already in
                      // view or when the row hasn't loaded into this page yet.
                      if (showRankColumn && myRank != null)
                        AnimatedBuilder(
                          animation: _scrollController,
                          builder: (context, _) {
                            final attached =
                                _scrollController.hasClients &&
                                _scrollController.position.haveDimensions;
                            final offset = attached
                                ? _scrollController.offset
                                : 0.0;
                            final viewportHeight = attached
                                ? _scrollController.position.viewportDimension
                                : 0.0;
                            final rowTop = currentUserIndex == -1
                                ? 0.0
                                : currentUserIndex * _kRowHeight;
                            final shouldShow = rowTop > offset + viewportHeight;
                            if (!shouldShow) return const SizedBox.shrink();
                            return Align(
                              key: const Key('leaderboard-sticky-footer'),
                              alignment: Alignment.bottomCenter,
                              child: Material(
                                elevation: 8,
                                color: Theme.of(context).colorScheme.surface,
                                child: _row(
                                  context: context,
                                  entry: LeaderboardEntry(
                                    userId: myRank.userId,
                                    name: myRank.name,
                                    profileImageUrl: myRank.profileImageUrl,
                                    rank: myRank.rank,
                                    minutesPlayed: myRank.minutesPlayed,
                                    badgeCount: myRank.badgeCount,
                                  ),
                                  showRankColumn: showRankColumn,
                                  isHighlighted: true,
                                ),
                              ),
                            );
                          },
                        ),
                    ],
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

/// Port of ally-mobile (React Native)'s `renderTableHeader` — column labels
/// above the ranked list, shown unconditionally (even while loading/empty),
/// same as RN.
class _TableHeaderRow extends ConsumerWidget {
  const _TableHeaderRow({required this.showRankColumn});

  final bool showRankColumn;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final style = Theme.of(context).textTheme.labelMedium?.copyWith(
      fontFamily: AppFonts.ibmPlexSerifMedium,
      color: AppColors.mediumEmphasis,
    );
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        children: [
          if (showRankColumn) ...[
            SizedBox(width: 32, child: Text(ref.t('community.table.rank'), style: style)),
            const SizedBox(width: 8),
          ],
          Expanded(
            child: Text(
              ref.t('community.table.user'),
              style: style,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          // Bounded + ellipsized, matching RN's own fixed-width
          // durationColumnHeader (88)/badgesColumnHeader (60) — an
          // unbounded `Text` here measured wider than the available row
          // width once real fonts were loaded (confirmed via a direct
          // screenshot render: this row threw a real RenderFlex overflow
          // at ordinary phone widths, not just a narrow edge case).
          SizedBox(
            width: 90,
            child: Text(
              ref.t('community.table.totalDuration'),
              style: style,
              textAlign: TextAlign.right,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: 16),
          SizedBox(
            width: 50,
            child: Text(
              ref.t('community.table.badges'),
              style: style,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}
