import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
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
    // RN renders the medal SVGs at their intrinsic size (rank1 24pt,
    // rank2/rank3 28pt) — no width/height passed.
    if (icon != null) return SvgPicture.asset(icon);
    // styles.rankBadge: a bare 26pt circle (no fill) + styles.rankText
    // (IBM_PLEX_SERIF.MEDIUM, label.medium, mediumEmphasis).
    return SizedBox(
      width: 26,
      height: 26,
      child: Center(
        child: Text(
          '$rank',
          style: const TextStyle(
            fontFamily: AppFonts.ibmPlexSerifMedium,
            fontSize: 12,
            height: 20 / 12,
            letterSpacing: 0.2,
            color: AppColors.mediumEmphasis,
          ),
        ),
      ),
    );
  }
}

/// RN `LeaderboardScreen`'s avatar: a 36pt circle (radius 20) showing the
/// profile image, or a blue50 circle with a 0.5pt stroke and the name's
/// first letter (IBM_PLEX_SERIF.MEDIUM, body.small, iconDefault, w600).
class _LeaderboardAvatar extends StatelessWidget {
  const _LeaderboardAvatar({required this.name, required this.imageUrl});

  final String name;
  final String imageUrl;

  @override
  Widget build(BuildContext context) {
    if (imageUrl.isNotEmpty) {
      return ClipOval(
        child: Image.network(imageUrl, width: 36, height: 36, fit: BoxFit.cover),
      );
    }
    return Container(
      key: const Key('leaderboard-avatar-placeholder'),
      width: 36,
      height: 36,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: AppColors.blue50,
        shape: BoxShape.circle,
        border: Border.all(color: AppColors.strokePrimary, width: 0.5),
      ),
      child: Text(
        name.isNotEmpty ? name[0].toUpperCase() : '',
        style: const TextStyle(
          fontFamily: AppFonts.ibmPlexSerifMedium,
          fontSize: 12,
          height: 16 / 12,
          letterSpacing: 0.2,
          fontWeight: FontWeight.w600,
          color: AppColors.iconDefault,
        ),
      ),
    );
  }
}

/// Row height used for the sticky-footer scroll math below. RN measures the
/// first non-highlighted row via `onLayout`; every such row is the same:
/// `paddingVertical: 10` around the 36pt avatar plus the separator's 12pt
/// top margin and hairline.
const double _kRowHeight = 10 + 36 + 12 + 1 / 3 + 10;

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

  /// RN `renderLeaderboardItem`. Column widths deliberately differ from
  /// the table header's (rank 21+38 vs 45, duration 95 vs 88), as in RN.
  Widget _row({
    required LeaderboardEntry entry,
    required bool showRankColumn,
    required bool isHighlighted,
  }) {
    final highlightColor = isHighlighted ? AppColors.blue : null;
    final highlightWeight = isHighlighted ? FontWeight.w500 : null;
    return Container(
      key: isHighlighted ? const Key('leaderboard-highlighted-row') : null,
      padding: EdgeInsets.only(top: 10, bottom: 10, left: isHighlighted ? 5 : 0),
      margin: isHighlighted ? const EdgeInsets.symmetric(horizontal: 8) : null,
      decoration: isHighlighted
          ? BoxDecoration(
              color: AppColors.blue50,
              border: Border.all(color: AppColors.primary, width: 0.5),
              borderRadius: BorderRadius.circular(8),
            )
          : null,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              if (showRankColumn)
                Container(
                  width: 38,
                  margin: EdgeInsets.only(left: isHighlighted ? 9 : 21),
                  alignment: Alignment.centerLeft,
                  child: _RankBadge(rank: entry.rank),
                ),
              Expanded(
                child: Padding(
                  padding: EdgeInsets.only(left: showRankColumn ? 0 : 21, right: 10),
                  child: Row(
                    children: [
                      _LeaderboardAvatar(name: entry.name, imageUrl: entry.profileImageUrl),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          entry.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontFamily: AppFonts.ibmPlexSerifMedium,
                            fontSize: 12,
                            height: 16 / 12,
                            letterSpacing: 0.2,
                            fontWeight: highlightWeight ?? FontWeight.w600,
                            color: highlightColor ?? AppColors.highEmphasis,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              SizedBox(
                width: 95,
                child: Text(
                  _formatDuration(entry.minutesPlayed),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontFamily: AppFonts.ibmPlexSerifRegular,
                    fontSize: 10,
                    height: 14 / 10,
                    letterSpacing: 0.3,
                    fontWeight: highlightWeight,
                    color: highlightColor ?? Colors.black,
                  ),
                ),
              ),
              SizedBox(
                width: 60,
                child: Text(
                  '${entry.badgeCount}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontFamily: AppFonts.ibmPlexSerifRegular,
                    fontSize: 10,
                    height: 14 / 10,
                    letterSpacing: 0.3,
                    fontWeight: highlightWeight,
                    color: highlightColor ?? AppColors.highEmphasis,
                  ),
                ),
              ),
            ],
          ),
          // styles.rowSeparator, inside the row (not on the highlighted one).
          if (!isHighlighted)
            Container(
              height: 1 / 3,
              margin: const EdgeInsets.only(left: 21, right: 21, top: 12),
              color: AppColors.strokePrimary,
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
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Column(
          children: [
            TabScreenHeader(
              title: ref.t('community.title'),
              tooltip:
                  '${ref.t('community.title')}\n${ref.t('achievements.badgeTooltipDescription')}',
              trailing: _BadgesButton(
                label: '$myBadgeCount ${ref.t('community.table.badges')}',
                onPressed: () => context.push('/achievements'),
              ),
            ),
            // styles.leaderboardHeader: right-aligned, 24pt sides, 10pt top/bottom.
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 10),
              child: Align(
                alignment: Alignment.centerRight,
                child: _PeriodDropdown(
                  // RN's `getPeriodLabel` translates this via `t()`.
                  value: ref.t(selectedWindow.labelKey),
                  options: [for (final window in LeaderboardWindow.values) ref.t(window.labelKey)],
                  onSelect: (label) {
                    final window = LeaderboardWindow.values.firstWhere((w) => ref.t(w.labelKey) == label);
                    ref.read(leaderboardWindowProvider.notifier).select(window);
                  },
                ),
              ),
            ),
            // styles.listContainer: marginBottom 100.
            Expanded(
              child: Padding(
                padding: const EdgeInsets.only(bottom: 100),
                child: Column(
                  children: [
                    _TableHeaderRow(showRankColumn: showRankColumn),
                    Expanded(
                      child: pageAsync.when(
                        loading: () => const _LeaderboardLoading(),
                        // RN's screen never reads the hook's error: a failed
                        // fetch leaves `data` empty and shows the empty state.
                        error: (_, _) => const _LeaderboardEmpty(),
                        data: (page) {
                          if (page.items.isEmpty) return const _LeaderboardEmpty();

                          final currentUserIndex =
                              myRank == null ? -1 : page.items.indexWhere((e) => e.userId == myRank.userId);

                          return Stack(
                            children: [
                              RefreshIndicator(
                                color: AppColors.primary,
                                onRefresh: () => ref.refresh(leaderboardControllerProvider.future),
                                child: ListView.builder(
                                  controller: _scrollController,
                                  padding: const EdgeInsets.only(bottom: 100),
                                  itemCount: page.items.length + (page.isLoadingMore ? 1 : 0),
                                  itemBuilder: (context, index) {
                                    if (index >= page.items.length) {
                                      return const Padding(
                                        padding: EdgeInsets.symmetric(vertical: 20),
                                        child: Center(
                                          child: SizedBox(
                                            width: 20,
                                            height: 20,
                                            child: CircularProgressIndicator(
                                              strokeWidth: 2,
                                              color: AppColors.primary,
                                            ),
                                          ),
                                        ),
                                      );
                                    }
                                    return _row(
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
                              if (showRankColumn && myRank != null && myRank.rank > 0)
                                AnimatedBuilder(
                                  animation: _scrollController,
                                  builder: (context, _) {
                                    final attached =
                                        _scrollController.hasClients && _scrollController.position.haveDimensions;
                                    final offset = attached ? _scrollController.offset : 0.0;
                                    final viewportHeight =
                                        attached ? _scrollController.position.viewportDimension : 0.0;
                                    final rowTop = currentUserIndex == -1 ? 0.0 : currentUserIndex * _kRowHeight;
                                    final shouldShow = rowTop > offset + viewportHeight;
                                    if (!shouldShow) return const SizedBox.shrink();
                                    // styles.stickyFooter: plain white, no shadow.
                                    return Align(
                                      key: const Key('leaderboard-sticky-footer'),
                                      alignment: Alignment.bottomCenter,
                                      child: ColoredBox(
                                        color: Colors.white,
                                        child: _row(
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
            ),
          ],
        ),
      ),
    );
  }
}

/// RN `renderBadgesButton`: the 20pt `BadgeIcon` + "N Badges" in
/// IBM_PLEX_SERIF.REGULAR label.medium, blue[500], `gap: 4`.
class _BadgesButton extends StatelessWidget {
  const _BadgesButton({required this.label, required this.onPressed});

  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onPressed,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SvgPicture.asset('assets/icons/badgeIcon.svg', width: 20, height: 20),
          const SizedBox(width: 4),
          Text(
            label,
            style: const TextStyle(
              fontFamily: AppFonts.ibmPlexSerifRegular,
              fontSize: 12,
              height: 20 / 12,
              letterSpacing: 0.2,
              color: AppColors.primary,
            ),
          ),
        ],
      ),
    );
  }
}

/// RN's loading state: a large primary ActivityIndicator, 40pt top/bottom.
class _LeaderboardLoading extends StatelessWidget {
  const _LeaderboardLoading();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: 40),
      child: Center(child: CircularProgressIndicator(color: AppColors.primary)),
    );
  }
}

/// RN `renderEmptyComponent`: headline.small title + body.medium
/// description, centred, 40pt sides and 60pt top/bottom.
class _LeaderboardEmpty extends ConsumerWidget {
  const _LeaderboardEmpty();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 40, vertical: 60),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              ref.t('community.emptyLeaderboard'),
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontFamily: AppFonts.ibmPlexSerifMedium,
                fontSize: 24,
                height: 32 / 24,
                color: AppColors.highEmphasis,
              ),
            ),
            const SizedBox(height: 12),
            Text(
              ref.t('community.emptyLeaderBoardDescription'),
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontFamily: AppFonts.ibmPlexSerifRegular,
                fontSize: 14,
                height: 22 / 14,
                letterSpacing: 0.2,
                color: AppColors.mediumEmphasis,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Port of RN's `CustomDropdown` as this screen configures it
/// (`fixedWidth={120}`, `alignModalRight`, `styles.dropdownHeader`/
/// `dropdownText`): a 120pt white header with a 0.5pt stroke, 4pt radius,
/// 12/20 IBM Plex Serif text and a 6pt arrow that flips when open; the menu
/// drops from 2pt above the header's bottom edge, right-aligned to it, at
/// least as wide as the longest option + 36, 10pt radius, lightGray7
/// border, body.medium items with the selected one in primary/w500.
/// The shared `AppDropdown` wraps Material's `DropdownMenu`, which can't
/// reproduce this header (it clipped "Last 7 days").
class _PeriodDropdown extends StatefulWidget {
  const _PeriodDropdown({required this.value, required this.options, required this.onSelect});

  final String value;
  final List<String> options;
  final ValueChanged<String> onSelect;

  @override
  State<_PeriodDropdown> createState() => _PeriodDropdownState();
}

class _PeriodDropdownState extends State<_PeriodDropdown> {
  bool _isOpen = false;

  static const _itemStyle = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifRegular,
    fontSize: 14,
    height: 22 / 14,
    letterSpacing: 0.2,
    color: AppColors.highEmphasis,
  );

  Future<void> _open() async {
    final box = context.findRenderObject()! as RenderBox;
    final topLeft = box.localToGlobal(Offset.zero);
    final rect = topLeft & box.size;
    final screenWidth = MediaQuery.sizeOf(context).width;
    final textScaler = MediaQuery.textScalerOf(context);
    final longest = widget.options.fold('', (a, b) => a.length >= b.length ? a : b);
    final painter = TextPainter(
      text: TextSpan(text: longest, style: _itemStyle),
      textDirection: TextDirection.ltr,
      textScaler: textScaler,
    )..layout();
    final minWidth = (painter.width + 36).ceilToDouble();
    painter.dispose();

    setState(() => _isOpen = true);
    final selected = await showGeneralDialog<String>(
      context: context,
      barrierDismissible: true,
      barrierLabel: MaterialLocalizations.of(context).modalBarrierDismissLabel,
      barrierColor: Colors.transparent,
      transitionDuration: Duration.zero,
      pageBuilder: (dialogContext, _, _) => Stack(
        children: [
          Positioned(
            top: rect.bottom - 2,
            right: screenWidth - rect.right,
            child: Container(
              key: const Key('leaderboard-period-menu'),
              constraints: BoxConstraints(
                minWidth: minWidth > rect.width ? minWidth : rect.width,
                maxHeight: (widget.options.length * 40).clamp(0, 200).toDouble(),
              ),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppColors.lightGray7),
                boxShadow: const [BoxShadow(color: Color(0x33000000), offset: Offset(0, 2), blurRadius: 4)],
              ),
              child: Material(
                type: MaterialType.transparency,
                child: SingleChildScrollView(
                  child: IntrinsicWidth(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        for (final option in widget.options)
                          GestureDetector(
                            behavior: HitTestBehavior.opaque,
                            onTap: () => Navigator.of(dialogContext).pop(option),
                            child: Padding(
                              padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
                              child: Text(
                                option,
                                style: option == widget.value
                                    ? _itemStyle.copyWith(color: AppColors.primary, fontWeight: FontWeight.w500)
                                    : _itemStyle,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
    if (!mounted) return;
    setState(() => _isOpen = false);
    if (selected != null) widget.onSelect(selected);
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      key: const Key('leaderboard-period-dropdown'),
      behavior: HitTestBehavior.opaque,
      onTap: _open,
      child: Container(
        width: 120,
        padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 8),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(4),
          border: Border.all(color: AppColors.strokePrimary, width: 0.5),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Flexible(
              child: Text(
                widget.value,
                style: const TextStyle(
                  fontFamily: AppFonts.ibmPlexSerifRegular,
                  fontSize: 12,
                  height: 20 / 12,
                  letterSpacing: 0.2,
                  color: AppColors.highEmphasis,
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.only(left: 8),
              child: RotatedBox(
                quarterTurns: _isOpen ? 2 : 0,
                child: SvgPicture.asset('assets/icons/arrowDown.svg', width: 6, height: 6),
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
/// same as RN: 12pt top/bottom, 21pt sides, lightGray2 bottom border,
/// 8pt below; rank 45, user flex (min 160), duration 88, badges 60;
/// IBM_PLEX_SERIF.REGULAR label.tiny in mediumEmphasis.
class _TableHeaderRow extends ConsumerWidget {
  const _TableHeaderRow({required this.showRankColumn});

  final bool showRankColumn;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    const style = TextStyle(
      fontFamily: AppFonts.ibmPlexSerifRegular,
      fontSize: 10,
      height: 14 / 10,
      letterSpacing: 0.3,
      color: AppColors.mediumEmphasis,
    );
    // Bounded + ellipsized: an unbounded label measured wider than the row
    // with real fonts once (a real RenderFlex overflow), so keep the guard.
    Text label(String key) =>
        Text(ref.t(key), style: style, maxLines: 1, overflow: TextOverflow.ellipsis);
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 21, vertical: 12),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppColors.lightGray2)),
      ),
      child: Row(
        children: [
          if (showRankColumn) SizedBox(width: 45, child: label('community.table.rank')),
          Expanded(child: label('community.table.user')),
          SizedBox(width: 88, child: label('community.table.totalDuration')),
          SizedBox(width: 60, child: label('community.table.badges')),
        ],
      ),
    );
  }
}
