import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/app_tab_view.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../data/achievements_repository.dart';

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
/// plus the same All/Unlocked filter tabs. Tap-to-mark-viewed is wired as
/// a deliberate substitute for the RN screen's unlock-celebration popup
/// (`useBadgePopup`, a separate app-wide polling feature, not a filter on
/// this screen, and not ported) — RN itself doesn't mark badges viewed
/// from a tap here, only from dismissing that popup, but with no popup
/// system in this app a badge would otherwise never leave "unviewed".
class AchievementsScreen extends ConsumerStatefulWidget {
  const AchievementsScreen({super.key});

  @override
  ConsumerState<AchievementsScreen> createState() => _AchievementsScreenState();
}

class _AchievementsScreenState extends ConsumerState<AchievementsScreen> {
  _AchievementsFilter _filter = _AchievementsFilter.all;

  @override
  Widget build(BuildContext context) {
    final badgesAsync = ref.watch(badgesProvider);

    return Scaffold(
      body: Column(
        children: [
          TabScreenHeader(
            title: ref.t('achievements.title'),
            // RN's real header always has a back arrow — this screen is
            // also reachable via a direct push (e.g. from Leaderboard's
            // Badges button), not only as the Achievements bottom tab, so
            // only show it when there's actually somewhere to pop back to.
            leading: GoRouter.of(context).canPop()
                ? IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => context.pop())
                : null,
          ),
          _buildFilterRow(context),
          Expanded(child: _buildBody(context, badgesAsync)),
        ],
      ),
    );
  }

  Widget _buildFilterRow(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 16, 24, 0),
      child: Row(
        children: [
          Text(ref.t('achievements.badges'), style: Theme.of(context).textTheme.labelLarge),
          const SizedBox(width: 4),
          _InfoTooltipIcon(message: ref.t('achievements.badgesTooltip')),
          const SizedBox(width: 12),
          Expanded(
            child: AppTabView<_AchievementsFilter>(
              tabs: [
                AppTabViewItem(key: _AchievementsFilter.all, label: ref.t('achievements.filters.all')),
                AppTabViewItem(
                  key: _AchievementsFilter.unlocked,
                  label: ref.t('achievements.filters.unlocked'),
                ),
              ],
              activeTab: _filter,
              onTabChange: (filter) => setState(() => _filter = filter),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBody(BuildContext context, AsyncValue<List<BadgeCategoryGroup>> badgesAsync) {
    return badgesAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Center(child: Text('${ref.t('achievements.errors.title')}: $error')),
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
          return Center(child: Text(ref.t('achievements.noAchievements')));
        }

        return ListView(
          padding: const EdgeInsets.all(16),
          children: [for (final group in filteredGroups) _CategorySection(group: group)],
        );
      },
    );
  }
}

class _CategorySection extends ConsumerWidget {
  const _CategorySection({required this.group});

  final BadgeCategoryGroup group;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final slug = _badgeCategorySlugs[group.category];
    final label = slug != null ? ref.t('achievements.badgeTypes.$slug') : group.category;

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(label, style: const TextStyle(fontFamily: AppFonts.ibmPlexSerifMedium, fontSize: 16)),
              const SizedBox(width: 4),
              if (slug != null) _InfoTooltipIcon(message: ref.t('achievements.badgeTypes.tooltip.$slug')),
              const SizedBox(width: 8),
              const Expanded(child: Divider()),
            ],
          ),
          const SizedBox(height: 8),
          for (final badge in group.badges) _AchievementCard(badge: badge),
        ],
      ),
    );
  }
}

/// RN's `AchievementCard` — a horizontal row: icon, then title+description.
class _AchievementCard extends ConsumerWidget {
  const _AchievementCard({required this.badge});

  final AchievementBadge badge;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isLocked = badge.lockStatus == BadgeLockStatus.locked;

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: GestureDetector(
        onTap: () => ref.read(achievementsRepositoryProvider).markBadgeAsViewed(badge.id),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: isLocked ? AppColors.lightGray2 : AppColors.strokePrimary, width: 0.5),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 60,
                height: 60,
                margin: const EdgeInsets.only(right: 16),
                decoration: BoxDecoration(
                  color: isLocked ? Colors.transparent : AppColors.lightGray,
                  borderRadius: BorderRadius.circular(12),
                ),
                clipBehavior: Clip.antiAlias,
                child: isLocked
                    ? SvgPicture.asset('assets/icons/achievementLocked.svg', width: 60, height: 60)
                    : (badge.imageUrl.isNotEmpty
                        ? Image.network(
                            badge.imageUrl,
                            fit: BoxFit.contain,
                            errorBuilder: (_, _, _) =>
                                SvgPicture.asset('assets/icons/badgeIcon.svg', width: 28, height: 28),
                          )
                        : Center(
                            child: SvgPicture.asset('assets/icons/badgeIcon.svg', width: 28, height: 28),
                          )),
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      badge.name,
                      style: TextStyle(
                        fontFamily: AppFonts.ibmPlexSerifMedium,
                        fontSize: 14,
                        color: isLocked ? AppColors.lowEmphasis : AppColors.highEmphasis,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      badge.description,
                      style: const TextStyle(
                        fontFamily: AppFonts.ibmPlexSerifRegular,
                        fontSize: 13,
                        color: AppColors.lowEmphasis,
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

/// RN's `InfoTooltip` — a tap-to-show info bubble. Ported via Flutter's own
/// `Tooltip` in tap-trigger mode rather than a custom popover, since that
/// already covers the same "tap the (i) icon, see explanatory text" need.
class _InfoTooltipIcon extends StatelessWidget {
  const _InfoTooltipIcon({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: message,
      triggerMode: TooltipTriggerMode.tap,
      child: const Icon(Icons.info_outline, size: 16, color: AppColors.mediumEmphasis),
    );
  }
}
