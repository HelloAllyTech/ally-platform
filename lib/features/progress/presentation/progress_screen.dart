import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/level_indicator.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../data/progress_repository.dart';

/// Direct port of ally-mobile (React Native)'s `ProgressScreen` — the XP
/// hero, lifetime-stat grid, and link cards to Leaderboard/Achievements
/// this app's `ProgressHeaderWidget` level ring opens into. Gated the same
/// way the header widget is (`canViewProgressProvider`), via
/// `progressDashboardProvider`.
class ProgressScreen extends ConsumerWidget {
  const ProgressScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final dashboardAsync = ref.watch(progressDashboardProvider);

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            TabScreenHeader(title: ref.t('progress.title'), hideProgressWidget: true),
            Expanded(
              child: dashboardAsync.when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (error, _) => Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(
                      ref.t('progress.errors.description'),
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: AppColors.red400),
                    ),
                  ),
                ),
                data: (dashboard) => dashboard == null
                    ? const SizedBox.shrink()
                    : RefreshIndicator(
                        onRefresh: () => ref.refresh(progressDashboardProvider.future),
                        child: ListView(
                          padding: const EdgeInsets.all(24),
                          children: [
                            _Hero(dashboard: dashboard),
                            const SizedBox(height: 16),
                            _StatsGrid(dashboard: dashboard),
                            const SizedBox(height: 16),
                            _LinkCard(
                              label: ref.t('progress.rank.link'),
                              onTap: () => context.push('/leaderboard'),
                            ),
                            const SizedBox(height: 16),
                            _LinkCard(
                              label: ref.t('progress.badges.link'),
                              onTap: () => context.push('/achievements'),
                            ),
                          ],
                        ),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Hero extends ConsumerWidget {
  const _Hero({required this.dashboard});

  final ProgressDashboard dashboard;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.strokePrimary, width: 0.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              LevelIndicator(
                level: dashboard.level,
                progress: dashboard.progress,
                isMaxLevel: dashboard.isMaxLevel,
                semanticLabel: ref.t('progress.a11y.level', {
                  'level': dashboard.level,
                  'xp': dashboard.totalXp,
                }),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      ref.t('progress.hero.level', {'level': dashboard.level}),
                      style: const TextStyle(
                        fontFamily: AppFonts.replayProHeadline,
                        fontSize: 24,
                        color: AppColors.highEmphasis,
                      ),
                    ),
                    const SizedBox(height: 4),
                    // At the top of the ladder there's no next target to
                    // point at, so the line is replaced rather than left
                    // rendering an empty/zero value.
                    Text(
                      dashboard.isMaxLevel
                          ? ref.t('progress.hero.maxLevel')
                          : ref.t('progress.hero.toNextLevel', {
                              'count': dashboard.xpToNextLevel ?? 0,
                              'level': dashboard.level + 1,
                            }),
                      style: const TextStyle(color: AppColors.mediumEmphasis, fontSize: 13),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: dashboard.progress.clamp(0, 1),
              minHeight: 8,
              backgroundColor: AppColors.lightGray2,
              color: AppColors.primary,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            ref.t('progress.hero.xpTotal', {'count': dashboard.totalXp}),
            style: const TextStyle(color: AppColors.mediumEmphasis, fontSize: 13),
          ),
        ],
      ),
    );
  }
}

class _StatsGrid extends ConsumerWidget {
  const _StatsGrid({required this.dashboard});

  final ProgressDashboard dashboard;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Wrap(
      spacing: 12,
      runSpacing: 12,
      children: [
        _StatCard(
          value: '${dashboard.lifetimePracticeMinutes}',
          label: ref.t('progress.stats.lifetimeMinutes'),
        ),
        _StatCard(
          value: '${dashboard.sessionsCompleted}',
          label: ref.t('progress.stats.sessions'),
        ),
        _StatCard(
          value: '${dashboard.trackItemsCompleted}',
          label: ref.t('progress.stats.trackItems'),
        ),
      ],
    );
  }
}

/// One cumulative number. Every stat here only ever goes up — a lost streak
/// or a bad session cannot take any of them away, same as RN's own comment
/// on `StatCard`.
class _StatCard extends StatelessWidget {
  const _StatCard({required this.value, required this.label});

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minWidth: 140),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.strokePrimary, width: 0.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            value,
            style: const TextStyle(
              fontFamily: AppFonts.replayProHeadline,
              fontSize: 24,
              color: AppColors.highEmphasis,
            ),
          ),
          const SizedBox(height: 6),
          Text(label, style: const TextStyle(color: AppColors.lowEmphasis, fontSize: 13)),
        ],
      ),
    );
  }
}

class _LinkCard extends StatelessWidget {
  const _LinkCard({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.strokePrimary, width: 0.5),
        ),
        child: Text(label, style: const TextStyle(color: AppColors.highEmphasis)),
      ),
    );
  }
}
