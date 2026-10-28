import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/app_tab_view.dart';
import '../../../core/widgets/info_tooltip_icon.dart';
import '../../../core/widgets/back_title_header.dart';
import '../data/achievements_repository.dart';
import 'badge_network_image.dart';

enum _AchievementsFilter { all, unlocked }

/// Mirrors ally-mobile (React Native)'s `BADGE_CATEGORY_MAP` — translates
/// the raw backend category into the i18n slug `achievements.badgeTypes.*`
/// keys are namespaced under.
const _badgeCategorySlugs = {
  'SIMULATION_MINUTES': 'journey',
  'ACTIVE_DAY_STREAK': 'momentum',
  'COMMENTS_REACTIONS_GIVEN': 'contribution',
  'COMMENTS_REACTIONS_RECEIVED': 'resonance',
};

/// Port of ally-mobile (React Native)'s `AchievementsScreen` — badges
/// grouped by category, each category with a translated label + an info
/// tooltip explaining how it's earned, rendered as RN's `AchievementCard`
/// (a horizontal icon+title+description row, not a grid of bare icons),
/// plus the same All/Unlocked filter tabs. Cards aren't tappable: as in RN,
/// a badge is marked viewed only by closing its unlock popup
/// (`badge_popup.dart`).
class AchievementsScreen extends ConsumerStatefulWidget {
  const AchievementsScreen({super.key});

  @override
  ConsumerState<AchievementsScreen> createState() => _AchievementsScreenState();
}

class _AchievementsScreenState extends ConsumerState<AchievementsScreen> {
  _AchievementsFilter _filter = _AchievementsFilter.all;

  static const _bodyMedium = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifRegular,
    fontSize: 14,
    height: 22 / 14,
    letterSpacing: 0.2,
    color: AppColors.mediumEmphasis,
  );

  @override
  Widget build(BuildContext context) {
    final badgesAsync = ref.watch(badgesProvider);

    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        top: false,
        child: Column(
          children: [
            // RN's own header (styles.header): always a black LeftArrowIcon,
            // 16pt gap, REPLAY_PRO.HEADLINE display.small title, 21/16
            // padding and a 0.5pt strokePrimary bottom border — also when
            // this is the reviewer-only Achievements tab.
            BackTitleHeader(
              title: ref.t('achievements.title'),
              margin: EdgeInsets.zero,
              padding: const EdgeInsets.symmetric(horizontal: 21, vertical: 16),
              gap: 16,
              borderColor: AppColors.strokePrimary,
              onBack: () {
                if (GoRouter.of(context).canPop()) context.pop();
              },
            ),
            _buildFilterRow(context),
            Expanded(child: _buildBody(context, badgesAsync)),
          ],
        ),
      ),
    );
  }

  /// styles.filterContainer/filterRow: 24pt sides, 16pt above; "Badges"
  /// (IBM_PLEX_SERIF.MEDIUM 16/24) + info icon on the left, the equal-width
  /// All/Unlocked TabView at 65% width on the right.
  Widget _buildFilterRow(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 16, 24, 0),
      child: LayoutBuilder(
        builder: (context, constraints) => Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Flexible(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Flexible(
                    child: Text(
                      ref.t('achievements.badges'),
                      style: const TextStyle(
                        fontFamily: AppFonts.ibmPlexSerifMedium,
                        fontSize: 16,
                        height: 24 / 16,
                        color: AppColors.highEmphasis,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  InfoTooltipIcon(message: ref.t('achievements.badgesTooltip')),
                  const SizedBox(width: 12),
                ],
              ),
            ),
            SizedBox(
              width: constraints.maxWidth * 0.65,
              child: AppTabView<_AchievementsFilter>(
                tabs: [
                  AppTabViewItem(key: _AchievementsFilter.all, label: ref.t('achievements.filters.all')),
                  AppTabViewItem(key: _AchievementsFilter.unlocked, label: ref.t('achievements.filters.unlocked')),
                ],
                activeTab: _filter,
                onTabChange: (filter) => setState(() => _filter = filter),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// styles.content: 24pt sides, 16pt top/bottom.
  static const _contentPadding = EdgeInsets.symmetric(horizontal: 24, vertical: 16);

  /// Loading/error/empty states scroll like the badge list does.
  Widget _scrollable(Widget child) => SingleChildScrollView(padding: _contentPadding, child: child);

  Widget _buildBody(BuildContext context, AsyncValue<List<BadgeCategoryGroup>> badgesAsync) {
    return badgesAsync.when(
      // styles.centerContainer: 48pt top/bottom.
      loading: () => _scrollable(
        const Padding(
          padding: EdgeInsets.symmetric(vertical: 48),
          child: Center(child: CircularProgressIndicator(color: AppColors.primary)),
        ),
      ),
      // styles.errorText: body.medium in ds.feedback.error.
      error: (_, _) => _scrollable(
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 48),
          child: Center(
            child: Text(
              ref.t('achievements.errors.description'),
              textAlign: TextAlign.center,
              style: _bodyMedium.copyWith(color: AppColors.error),
            ),
          ),
        ),
      ),
      data: (groups) {
        final filteredGroups = _filter == _AchievementsFilter.all
            ? groups
            : [
                for (final group in groups)
                  BadgeCategoryGroup(
                    category: group.category,
                    badges: group.badges.where((b) => b.lockStatus == BadgeLockStatus.unlocked).toList(),
                  ),
              ].where((group) => group.badges.isNotEmpty).toList();

        if (filteredGroups.isEmpty) {
          // styles.emptyContainer/emptyText.
          return _scrollable(
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 48),
              child: Center(
                child: Text(ref.t('achievements.noAchievements'), textAlign: TextAlign.center, style: _bodyMedium),
              ),
            ),
          );
        }

        // One flat lazily-built list (header, cards, 24pt section gap per
        // category) instead of every badge card — each an IntrinsicHeight
        // row with a network icon — laid out up front in a Column.
        final rows = <Object>[
          for (final group in filteredGroups) ...[
            group,
            ...group.badges,
            _sectionGap,
          ],
        ];
        return ListView.builder(
          padding: _contentPadding,
          itemCount: rows.length,
          itemBuilder: (context, index) => switch (rows[index]) {
            final BadgeCategoryGroup group => _CategoryHeader(group: group),
            final AchievementBadge badge => _AchievementCard(badge: badge),
            _ => const SizedBox(height: 24),
          },
        );
      },
    );
  }
}

/// Marker for the 24pt gap below each category section in the flat list.
const _sectionGap = Object();

/// RN `renderCategorySection`: 24pt below each section (a separate list
/// row); header row (12pt below) of the body.small lowEmphasis category
/// label, the info icon and a 0.5pt strokePrimary rule filling the rest.
class _CategoryHeader extends ConsumerWidget {
  const _CategoryHeader({required this.group});

  final BadgeCategoryGroup group;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final slug = _badgeCategorySlugs[group.category];
    final label = slug != null ? ref.t('achievements.badgeTypes.$slug') : group.category;

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        children: [
          Text(
            label,
            style: const TextStyle(
              fontFamily: AppFonts.ibmPlexSerifRegular,
              fontSize: 12,
              height: 16 / 12,
              letterSpacing: 0.2,
              color: AppColors.lowEmphasis,
            ),
          ),
          const SizedBox(width: 8),
          InfoTooltipIcon(
            message: ref.t('achievements.badgeTypes.tooltip.${slug ?? group.category}'),
          ),
          const SizedBox(width: 12),
          Expanded(child: Container(height: 0.5, color: AppColors.strokePrimary)),
        ],
      ),
    );
  }
}

/// RN's `AchievementCard` — a horizontal row: icon, then title+description
/// centred vertically beside it.
class _AchievementCard extends ConsumerWidget {
  const _AchievementCard({required this.badge});

  final AchievementBadge badge;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isLocked = badge.lockStatus == BadgeLockStatus.locked;

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: isLocked ? AppColors.lightGray2 : AppColors.strokePrimary, width: 0.5),
        ),
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                width: 60,
                height: 60,
                margin: const EdgeInsets.only(right: 16),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: isLocked ? Colors.transparent : AppColors.lightGray1,
                  borderRadius: BorderRadius.circular(12),
                ),
                clipBehavior: Clip.antiAlias,
                child: isLocked
                    // AchievementLockedIcon at its intrinsic 60x60.
                    ? SvgPicture.asset('assets/icons/achievementLocked.svg')
                    // RN NetworkImage: SVG badge art via flutter_svg.
                    : (badge.imageUrl.isNotEmpty
                        ? BadgeNetworkImage(url: badge.imageUrl, width: 60, height: 60)
                        : const SizedBox.shrink()),
              ),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: Text(
                        badge.name,
                        style: TextStyle(
                          fontFamily: AppFonts.ibmPlexSerifMedium,
                          fontSize: 14,
                          height: 18 / 14,
                          letterSpacing: 0,
                          fontWeight: FontWeight.w500,
                          color: isLocked ? AppColors.lowEmphasis : AppColors.highEmphasis,
                        ),
                      ),
                    ),
                    Text(
                      badge.description,
                      style: TextStyle(
                        fontFamily: AppFonts.ibmPlexSerifRegular,
                        fontSize: 13,
                        height: 18 / 13,
                        letterSpacing: 0,
                        color: isLocked ? AppColors.lowEmphasis : AppColors.mediumEmphasis,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
