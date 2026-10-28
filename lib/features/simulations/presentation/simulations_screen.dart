import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/app_tab_view.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../../courses/data/course_models.dart';
import '../../courses/data/courses_repository.dart';
import '../data/simulation_models.dart';
import '../data/simulations_repository.dart';
import 'widgets/circular_progress.dart';
import 'widgets/credits_display.dart';
import 'widgets/learn_tab_view.dart';
import 'widgets/simulation_card.dart';
import 'widgets/simulations_skeleton.dart';

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
      // RN's styles.container: white, not the app's off-white background.
      backgroundColor: Colors.white,
      body: Column(
        children: [
          TabScreenHeader(
            title: ref.t('common.appName'),
            subtitle: ref.t('nav.tabs.learn'),
            italicSubtitle: true,
            trailing: const CreditsDisplay(),
          ),
          Expanded(
            // styles.marginH21
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 21),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // styles.introWrapper
                  const SizedBox(height: 22),
                  _LearnIntro(ref: ref),
                  // styles.tabMargin: marginVertical 16. RN renders the
                  // TabView even when only one tab is visible.
                  const SizedBox(height: 16),
                  if (visibleTabs.isNotEmpty) ...[
                    LearnTabView<_LearnTab>(
                      tabs: [
                        for (final tab in visibleTabs)
                          AppTabViewItem(key: tab, label: ref.t(_tabLabelKey(tab))),
                      ],
                      activeTab: activeTab,
                      onTabChange: (tab) => setState(() => _requestedTab = tab),
                    ),
                    const SizedBox(height: 16),
                  ],
                  _ListTitle(noun: ref.t(_tabNoun(activeTab)), ref: ref),
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

  String _emptyKey(_LearnTab tab) => switch (tab) {
    _LearnTab.courses => 'simulationPage.noCoursesAvailable',
    _LearnTab.cases => 'simulationPage.noCasesAvailable',
    _LearnTab.simulations => 'simulationPage.noSimulationsAvailable',
    _LearnTab.paths => 'simulationPage.noPathsAvailable',
  };

  /// RN's per-tab `FlatList`: pull-to-refresh, the skeleton while the query
  /// is fetching with nothing to show yet, and the "No … available" title
  /// otherwise. RN has no separate error state — a failed query just has no
  /// data, so it reads as empty.
  Widget _list<T>(
    _LearnTab tab,
    AsyncValue<List<T>> async,
    Widget Function(T item) itemBuilder,
    VoidCallback onRefresh,
  ) {
    final items = async.value ?? <T>[];
    Widget body;
    if (items.isEmpty) {
      body = ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          if (async.isLoading)
            const SimulationsSkeleton(count: 4)
          else
            _EmptyTitle(text: ref.t(_emptyKey(tab))),
        ],
      );
    } else {
      body = ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        // styles.list
        padding: const EdgeInsets.only(top: 10, bottom: 360),
        itemCount: items.length,
        separatorBuilder: (_, _) => const SizedBox(height: 10),
        itemBuilder: (context, index) => itemBuilder(items[index]),
      );
    }
    return RefreshIndicator(
      onRefresh: () async => onRefresh(),
      child: body,
    );
  }

  Widget _buildTabContent(
    _LearnTab activeTab,
    AsyncValue<List<TrackListItem>> tracksAsync,
    AsyncValue<List<SimulationPath>> casesAsync,
    AsyncValue<List<Scenario>> scenariosAsync,
    AsyncValue<List<SimulationPath>> pathsAsync,
  ) {
    switch (activeTab) {
      case _LearnTab.courses:
        return _list<TrackListItem>(
          activeTab,
          tracksAsync,
          (track) => SimulationCard(
            title: track.title,
            description: track.description,
            coverImageUrl: track.coverImageUrl,
            onTap: () => context.push('/courses/${track.id}'),
            rightAccessory: _progressRing(track.completedItems, track.totalItems),
          ),
          () => ref.invalidate(learnTracksProvider),
        );
      case _LearnTab.cases:
        return _list<SimulationPath>(
          activeTab,
          casesAsync,
          (caseItem) => SimulationCard(
            title: caseItem.title,
            description: '${caseItem.totalScenarios} ${ref.t('calls.table.scenario')}',
            coverImageUrl: caseItem.coverImageUrl,
            onTap: () => context.push('/cases/${caseItem.id}'),
            rightAccessory: _progressRing(
              caseItem.completedScenarios,
              caseItem.totalScenarios,
            ),
          ),
          () => ref.invalidate(casesProvider),
        );
      case _LearnTab.simulations:
        return _list<Scenario>(
          activeTab,
          scenariosAsync,
          (scenario) => SimulationCard(
            title: scenario.title,
            description: scenario.description,
            coverImageUrl: scenario.coverImageUrl,
            triggerWarnings: scenario.triggerWarnings,
            // RN's SimulationDetailsScreen never fetches by id at all — it
            // just reads `route.params.scenario`, trusting this
            // already-fetched list item completely; passing it through
            // matches that (and is what made the language dropdown appear).
            onTap: () => context.push('/simulations/${scenario.id}', extra: scenario),
            rightAccessory: scenario.completedAttemptCount > 0
                ? _CompletedBadge(count: scenario.completedAttemptCount)
                : null,
          ),
          () => ref.invalidate(scenariosProvider),
        );
      case _LearnTab.paths:
        return _list<SimulationPath>(
          activeTab,
          pathsAsync,
          (path) => SimulationCard(
            title: path.title,
            description: '${path.totalScenarios} ${ref.t('calls.table.scenario')}',
            coverImageUrl: path.coverImageUrl,
            onTap: () => context.push('/simulation-paths/${path.id}'),
            rightAccessory: _progressRing(path.completedScenarios, path.totalScenarios),
          ),
          () => ref.invalidate(scenarioPathsProvider),
        );
    }
  }

  /// RN's course/case/path `rightAccessory`: a 33px ring with "done/total"
  /// inside, green once complete, `colors.blue` while in progress. Hidden
  /// until at least one item is done (`!!progress && !!total`).
  Widget? _progressRing(int progress, int total) {
    if (progress == 0 || total == 0) return null;
    final isCompleted = progress >= total;
    return CircularProgress(
      key: const Key('learn-progress-ring'),
      progress: progress,
      max: total,
      size: 33,
      strokeWidth: 3,
      progressColor: isCompleted ? AppColors.green400 : AppColors.legacyBlue,
      // styles.progressText: IBM_PLEX_SERIF.MEDIUM + body.nano.
      child: Text(
        '$progress/$total',
        style: const TextStyle(
          fontFamily: AppFonts.ibmPlexSerifMedium,
          fontSize: 8,
          height: 10 / 8,
          letterSpacing: 0.08,
          fontWeight: FontWeight.w500,
          color: AppColors.mediumEmphasis,
        ),
      ),
    );
  }
}

/// RN's `styles.listTitle`: "Choose your" + an italic noun that changes with
/// the active tab (e.g. "Choose your Course").
class _ListTitle extends StatelessWidget {
  const _ListTitle({required this.noun, required this.ref});

  final String noun;
  final WidgetRef ref;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Text.rich(
        TextSpan(
          style: const TextStyle(
            fontFamily: AppFonts.replayProHeadline,
            fontSize: 18,
            height: 24 / 18,
            letterSpacing: 0.18,
            fontWeight: FontWeight.w500,
            color: AppColors.darkGray12,
          ),
          text: '${ref.t('learn.choose.prefix')} ',
          children: [
            // styles.pageTitleItalic
            TextSpan(
              text: noun,
              style: const TextStyle(
                fontFamily: AppFonts.replayProBoldItalic,
                fontStyle: FontStyle.italic,
              ),
            ),
          ],
        ),
        textAlign: TextAlign.center,
      ),
    );
  }
}

/// RN's `ListEmptyElement` (styles.empty / styles.emptyTitle).
class _EmptyTitle extends StatelessWidget {
  const _EmptyTitle({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 40),
      child: Text(
        text,
        textAlign: TextAlign.center,
        style: const TextStyle(
          fontFamily: AppFonts.replayProHeadline,
          fontSize: 16,
          color: AppColors.darkGray12,
        ),
      ),
    );
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
    // styles.introText: REPLAY_PRO.HEADLINE + display.small, light, darkSlate.
    const baseStyle = TextStyle(
      fontFamily: AppFonts.replayProHeadline,
      fontSize: 18,
      height: 24 / 18,
      letterSpacing: 0.18,
      fontWeight: FontWeight.w300,
      color: AppColors.darkSlate,
    );
    // styles.blueBold: REPLAY_PRO.BOLD, medium, azureBlue.
    const blueStyle = TextStyle(
      fontFamily: AppFonts.replayProBold,
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

/// RN's role-play `rightAccessory`: tick + "Completed · N×", beside the
/// card text (not pinned to the top corner).
class _CompletedBadge extends ConsumerWidget {
  const _CompletedBadge({required this.count});

  final int count;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        // TickRoundIcon 16x16; its fill (#81C784) is baked into the SVG, so
        // RN's `color` prop has no effect on it.
        SvgPicture.asset('assets/icons/tickRound.svg', width: 16, height: 16),
        const SizedBox(width: 4),
        Text(
          count == 1
              ? ref.t('simulations.completed_one')
              : ref.t('simulations.completed_other', {'count': count}),
          // styles.completedBadgeText: IBM_PLEX_SERIF.MEDIUM + body.nano.
          style: const TextStyle(
            fontFamily: AppFonts.ibmPlexSerifMedium,
            fontSize: 8,
            height: 10 / 8,
            letterSpacing: 0.08,
            fontWeight: FontWeight.w500,
            color: AppColors.green700,
          ),
        ),
      ],
    );
  }
}
