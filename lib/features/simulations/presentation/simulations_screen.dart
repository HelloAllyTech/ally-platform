import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_tab_view.dart';
import '../../../core/widgets/html_rich_text.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../../courses/data/course_models.dart';
import '../../courses/data/courses_repository.dart';
import '../data/simulation_models.dart';
import '../data/simulations_repository.dart';

enum _LearnTab { courses, cases, simulations, paths }

/// Port of ally-mobile (React Native)'s `SimulationsScreen` — the real
/// "Learn" bottom tab. RN backs this with ONE screen holding an internal
/// tab switcher across Courses/Cases/Simulations/Tracks (each tab hidden
/// until its own query resolves with data, falling back to the first
/// still-visible tab if the active one disappears) — not four separate
/// screens. This app previously had just a flat scenario list here, with
/// Courses/Cases only reachable via the dev-only placeholder HomeScreen —
/// unreachable from the real bottom nav, same gap this restructure closes.
class SimulationsScreen extends ConsumerStatefulWidget {
  const SimulationsScreen({super.key});

  @override
  ConsumerState<SimulationsScreen> createState() => _SimulationsScreenState();
}

class _SimulationsScreenState extends ConsumerState<SimulationsScreen> {
  _LearnTab _requestedTab = _LearnTab.simulations;

  @override
  Widget build(BuildContext context) {
    final tracksAsync = ref.watch(learnTracksProvider);
    final casesAsync = ref.watch(casesProvider);
    final scenariosAsync = ref.watch(scenariosProvider);
    final pathsAsync = ref.watch(scenarioPathsProvider);
    final creditsAsync = ref.watch(simulationCreditsProvider);

    bool show<T>(AsyncValue<List<T>> async) =>
        async.isLoading || (async.value?.isNotEmpty ?? false);

    final visibleTabs = [
      if (show(tracksAsync)) _LearnTab.courses,
      if (show(casesAsync)) _LearnTab.cases,
      if (show(scenariosAsync)) _LearnTab.simulations,
      if (show(pathsAsync)) _LearnTab.paths,
    ];
    // Tabs can hide/show as their queries resolve — if the active tab
    // disappears, fall back to the first tab that's still visible.
    final activeTab = visibleTabs.contains(_requestedTab)
        ? _requestedTab
        : (visibleTabs.isNotEmpty ? visibleTabs.first : _requestedTab);

    return Scaffold(
      body: Column(
        children: [
          TabScreenHeader(
            title: ref.t('common.appName'),
            subtitle: ref.t('nav.tabs.learn'),
            italicSubtitle: true,
            trailing: creditsAsync.when(
              // RN's styles.creditText: display.small size, but
              // IBM_PLEX_SERIF.MEDIUM family — not the ambient default.
              data: (credits) => Text(
                ref.t('simulations.creditsRemaining', {
                  'count': credits.remaining,
                }),
                style: Theme.of(context).textTheme.displaySmall
                    ?.copyWith(fontFamily: AppFonts.ibmPlexSerifMedium),
              ),
              loading: () => const SizedBox.shrink(),
              error: (_, _) => const SizedBox.shrink(),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 21),
            child: Column(
              children: [
                const SizedBox(height: 22),
                _LearnIntro(ref: ref),
                const SizedBox(height: 16),
                if (visibleTabs.length > 1)
                  AppTabView<_LearnTab>(
                    tabs: [
                      for (final tab in visibleTabs)
                        AppTabViewItem(key: tab, label: ref.t(_tabLabelKey(tab))),
                    ],
                    activeTab: activeTab,
                    onTabChange: (tab) => setState(() => _requestedTab = tab),
                  ),
              ],
            ),
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 21),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // RN's listTitle: "Choose your" + an italic noun that
                  // changes with the active tab (e.g. "Choose your Course").
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Text.rich(
                      TextSpan(
                        style: const TextStyle(
                          fontFamily: AppFonts.replayProHeadline,
                          fontSize: 24,
                          fontWeight: FontWeight.w300,
                          color: AppColors.highEmphasis,
                        ),
                        children: [
                          TextSpan(text: '${ref.t('learn.choose.prefix')} '),
                          TextSpan(
                            text: ref.t(_tabNoun(activeTab)),
                            style: const TextStyle(
                              fontStyle: FontStyle.italic,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ],
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ),
                  Expanded(
                    child: _buildTabContent(
                      activeTab,
                      tracksAsync,
                      casesAsync,
                      scenariosAsync,
                      pathsAsync,
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

  String _tabNoun(_LearnTab tab) => switch (tab) {
    _LearnTab.courses => 'simulations.course',
    _LearnTab.cases => 'simulations.case',
    _LearnTab.simulations => 'simulations.simulation',
    _LearnTab.paths => 'simulations.track',
  };

  String _tabLabelKey(_LearnTab tab) => switch (tab) {
    _LearnTab.courses => 'simulations.courses',
    _LearnTab.cases => 'simulations.cases',
    _LearnTab.simulations => 'simulations.simulation',
    _LearnTab.paths => 'simulations.tracks',
  };

  Widget _buildTabContent(
    _LearnTab activeTab,
    AsyncValue<List<TrackListItem>> tracksAsync,
    AsyncValue<List<SimulationPath>> casesAsync,
    AsyncValue<List<Scenario>> scenariosAsync,
    AsyncValue<List<SimulationPath>> pathsAsync,
  ) {
    switch (activeTab) {
      case _LearnTab.courses:
        return tracksAsync.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) =>
              Center(child: Text('${ref.t('courses.listLoadFailed')}: $error')),
          data: (tracks) => tracks.isEmpty
              ? Center(child: Text(ref.t('simulationPage.noCoursesAvailable')))
              : ListView.builder(
                  padding: const EdgeInsets.only(top: 10, bottom: 100),
                  itemCount: tracks.length,
                  itemBuilder: (context, index) {
                    final track = tracks[index];
                    final showProgress =
                        track.completedItems > 0 && track.totalItems > 0;
                    return _LearnListCard(
                      title: track.title,
                      description: track.description,
                      coverImageUrl: track.coverImageUrl,
                      onTap: () => context.push('/courses/${track.id}'),
                      trailing: showProgress
                          ? _ProgressBadge(
                              current: track.completedItems,
                              total: track.totalItems,
                            )
                          : null,
                    );
                  },
                ),
        );
      case _LearnTab.cases:
        return casesAsync.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => Center(
            child: Text('${ref.t('simulations.failedToLoadCases')}: $error'),
          ),
          data: (cases) => cases.isEmpty
              ? Center(child: Text(ref.t('simulationPage.noCasesAvailable')))
              : ListView.builder(
                  padding: const EdgeInsets.only(top: 10, bottom: 100),
                  itemCount: cases.length,
                  itemBuilder: (context, index) {
                    final caseItem = cases[index];
                    final showProgress =
                        caseItem.completedScenarios > 0 &&
                        caseItem.totalScenarios > 0;
                    return _LearnListCard(
                      title: caseItem.title,
                      description:
                          '${caseItem.totalScenarios} ${ref.t('calls.table.scenario')}',
                      coverImageUrl: caseItem.coverImageUrl,
                      onTap: () => context.push('/cases/${caseItem.id}'),
                      trailing: showProgress
                          ? _ProgressBadge(
                              current: caseItem.completedScenarios,
                              total: caseItem.totalScenarios,
                            )
                          : null,
                    );
                  },
                ),
        );
      case _LearnTab.simulations:
        return scenariosAsync.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => Center(
            child: Text(
              '${ref.t('simulations.failedToLoadScenarios')}: $error',
            ),
          ),
          data: (scenarios) => scenarios.isEmpty
              ? Center(
                  child: Text(ref.t('simulationPage.noSimulationsAvailable')),
                )
              : ListView.builder(
                  padding: const EdgeInsets.only(top: 10, bottom: 100),
                  itemCount: scenarios.length,
                  itemBuilder: (context, index) {
                    final scenario = scenarios[index];
                    return _LearnListCard(
                      title: scenario.title,
                      description: scenario.description,
                      coverImageUrl: scenario.coverImageUrl,
                      triggerWarnings: scenario.triggerWarnings,
                      // RN's SimulationDetailsScreen never fetches by id at
                      // all — it just reads `route.params.scenario`, trusting
                      // this already-fetched list item completely. Passing
                      // it through here instead of re-fetching via a
                      // `scenarios/:id` call RN's own UI never exercises
                      // matches that exactly, and was the prime suspect for
                      // why no scenario ever showed a language dropdown on a
                      // real device (reported live) even though the by-id
                      // endpoint looks logically equivalent on paper.
                      onTap: () =>
                          context.push('/simulations/${scenario.id}', extra: scenario),
                      trailing: scenario.completedAttemptCount > 0
                          ? _CompletedBadge(
                              count: scenario.completedAttemptCount,
                            )
                          : null,
                    );
                  },
                ),
        );
      case _LearnTab.paths:
        return pathsAsync.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => Center(
            child: Text('${ref.t('common.somethingWentWrong')} $error'),
          ),
          data: (paths) => paths.isEmpty
              ? Center(child: Text(ref.t('simulationPage.noPathsAvailable')))
              : ListView.builder(
                  padding: const EdgeInsets.only(top: 10, bottom: 100),
                  itemCount: paths.length,
                  itemBuilder: (context, index) {
                    final path = paths[index];
                    final showProgress =
                        path.completedScenarios > 0 && path.totalScenarios > 0;
                    return _LearnListCard(
                      title: path.title,
                      description:
                          '${path.totalScenarios} ${ref.t('calls.table.scenario')}',
                      coverImageUrl: path.coverImageUrl,
                      onTap: () => context.push('/simulation-paths/${path.id}'),
                      trailing: showProgress
                          ? _ProgressBadge(
                              current: path.completedScenarios,
                              total: path.totalScenarios,
                            )
                          : null,
                    );
                  },
                ),
        );
    }
  }
}

/// RN's intro `Trans` string with two `<blue>...</blue>` spans — scoped to
/// this one key rather than a generic rich-translation system, same as
/// LoginScreen's hand-composed Terms footer.
class _LearnIntro extends StatelessWidget {
  const _LearnIntro({required this.ref});

  final WidgetRef ref;

  @override
  Widget build(BuildContext context) {
    const baseStyle = TextStyle(
      fontFamily: AppFonts.replayProHeadline,
      fontSize: 24,
      fontWeight: FontWeight.w300,
      color: Color(0xFF292929),
      height: 1.2,
    );
    const blueStyle = TextStyle(
      fontFamily: AppFonts.replayProHeadline,
      fontWeight: FontWeight.w500,
      color: AppColors.primary,
    );

    final raw = ref.t('simulations.learnIntro');
    final spans = <InlineSpan>[];
    final pattern = RegExp(r'<blue>(.*?)</blue>');
    var cursor = 0;
    for (final match in pattern.allMatches(raw)) {
      if (match.start > cursor) {
        spans.add(TextSpan(text: raw.substring(cursor, match.start)));
      }
      spans.add(TextSpan(text: match.group(1), style: blueStyle));
      cursor = match.end;
    }
    if (cursor < raw.length) spans.add(TextSpan(text: raw.substring(cursor)));

    return Text.rich(
      TextSpan(style: baseStyle, children: spans),
      textAlign: TextAlign.center,
    );
  }
}

/// RN's shared `SimulationCard` — full-width cover image banner (not a
/// thumbnail), title, plain-text description (HTML stripped, same as the
/// card's own `htmlToPlainText`; the detail screen is where HTML renders
/// structurally), optional trigger-warning chips, and a trailing accessory.
class _LearnListCard extends StatelessWidget {
  const _LearnListCard({
    required this.title,
    required this.description,
    required this.coverImageUrl,
    required this.onTap,
    this.trailing,
    this.triggerWarnings = const [],
  });

  final String title;
  final String? description;
  final String? coverImageUrl;
  final VoidCallback onTap;
  final Widget? trailing;
  final List<String> triggerWarnings;

  @override
  Widget build(BuildContext context) {
    final plainDescription = htmlToPlainText(description);

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: AppCard(
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (coverImageUrl != null) ...[
                  ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: Image.network(
                      coverImageUrl!,
                      height: 150,
                      width: double.infinity,
                      fit: BoxFit.cover,
                      errorBuilder: (_, _, _) =>
                          Container(height: 150, color: AppColors.lightGray2),
                    ),
                  ),
                  const SizedBox(height: 8),
                ],
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            title.isEmpty ? '-' : title,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontFamily: AppFonts.ibmPlexSerifMedium,
                              fontSize: 16,
                              color: AppColors.highEmphasis,
                            ),
                          ),
                          if (plainDescription.isNotEmpty) ...[
                            const SizedBox(height: 4),
                            Text(
                              plainDescription,
                              maxLines: 3,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontFamily: AppFonts.ibmPlexSerifRegular,
                                fontSize: 13,
                                color: AppColors.mediumEmphasis,
                              ),
                            ),
                          ],
                          if (triggerWarnings.isNotEmpty) ...[
                            const SizedBox(height: 8),
                            Wrap(
                              spacing: 6,
                              runSpacing: 6,
                              children: [
                                for (final warning in triggerWarnings)
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 8,
                                      vertical: 4,
                                    ),
                                    decoration: BoxDecoration(
                                      color: AppColors.lightGray,
                                      borderRadius: BorderRadius.circular(999),
                                      border: Border.all(
                                        color: AppColors.lightGray2,
                                        width: 0.5,
                                      ),
                                    ),
                                    child: Text(
                                      warning,
                                      style: const TextStyle(
                                        fontSize: 11,
                                        color: AppColors.mediumEmphasis,
                                      ),
                                    ),
                                  ),
                              ],
                            ),
                          ],
                        ],
                      ),
                    ),
                    if (trailing != null) ...[
                      const SizedBox(width: 8),
                      trailing!,
                    ],
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ProgressBadge extends StatelessWidget {
  const _ProgressBadge({required this.current, required this.total});

  final int current;
  final int total;

  @override
  Widget build(BuildContext context) {
    return Text(
      '$current/$total',
      style: const TextStyle(
        fontFamily: AppFonts.ibmPlexSerifMedium,
        fontSize: 12,
        color: AppColors.mediumEmphasis,
      ),
    );
  }
}

class _CompletedBadge extends ConsumerWidget {
  const _CompletedBadge({required this.count});

  final int count;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.check_circle, size: 14, color: Colors.green),
        const SizedBox(width: 4),
        Text(
          count == 1
              ? ref.t('simulations.completed_one')
              : ref.t('simulations.completed_other', {'count': count}),
          style: const TextStyle(
            fontFamily: AppFonts.ibmPlexSerifMedium,
            fontSize: 11,
            color: Colors.green,
          ),
        ),
      ],
    );
  }
}
