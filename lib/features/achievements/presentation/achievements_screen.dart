import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/widgets/app_tab_view.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../data/achievements_repository.dart';

enum _AchievementsFilter { all, unlocked }

/// Port of ally-mobile (React Native)'s `AchievementsScreen` — badges
/// grouped by category, locked/unlocked state, and the same All/Unlocked
/// filter tabs (`FilterType`). Tap-to-mark-viewed is wired; the RN screen's
/// unlock-celebration popup (`useBadgePopup`, a separate app-wide polling
/// feature, not a filter on this screen) is not ported.
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
          TabScreenHeader(title: ref.t('achievements.title')),
          Expanded(child: _buildBody(context, badgesAsync)),
        ],
      ),
    );
  }

  Widget _buildBody(BuildContext context, AsyncValue<List<BadgeCategoryGroup>> badgesAsync) {
    return badgesAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) =>
            Center(child: Text('${ref.t('achievements.errors.title')}: $error')),
        data: (groups) {
          final filteredGroups = _filter == _AchievementsFilter.all
              ? groups
              : [
                  for (final group in groups)
                    BadgeCategoryGroup(
                      category: group.category,
                      badges: group.badges
                          .where((b) => b.lockStatus == BadgeLockStatus.unlocked)
                          .toList(),
                    ),
                ].where((group) => group.badges.isNotEmpty).toList();

          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Padding(
                padding: const EdgeInsets.only(bottom: 16),
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
              for (final group in filteredGroups) ...[
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
                                    ? SvgPicture.asset(
                                        badge.lockStatus == BadgeLockStatus.unlocked
                                            ? 'assets/icons/badgeIcon.svg'
                                            : 'assets/icons/achievementLocked.svg',
                                        width: 28,
                                        height: 28,
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
          );
        },
      );
  }
}
