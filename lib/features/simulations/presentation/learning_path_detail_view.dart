import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../data/simulation_models.dart';
import '../data/simulations_repository.dart';
import 'simulation_details_modal.dart';
import 'start_simulation/start_simulation_controller.dart';
import 'widgets/learning_path_widgets.dart';

/// Shared body for CaseDetailsScreen and SimulationPathDetailsScreen — ally-
/// mobile (React Native)'s `useLearningPathDetails` hook backs both with
/// "identical logic" (its own doc comment), and `Case`/`CaseDetails` are
/// literal type aliases of `SimulationPath`/`SimulationPathDetails`, so one
/// widget here avoids duplicating the resumption flow twice.
///
/// Renders RN's `LearningPathListHeader` (cover, title, description,
/// progress bar), a Start/Continue button that resumes at
/// [SimulationPathDetails.nextScenario] (same definition as the RN
/// screen's `nextSimulation`), and the scenario list with per-status
/// affordances — locked (disabled), completed (view-feedback action),
/// unlocked (tap to start that specific scenario, not just the next one).
/// Both the top button and a row tap go through the same
/// [SimulationDetailsModal] preview before actually starting, matching RN's
/// own `setSelectedSimulation` being shared by `handleStartPath` and
/// `handleSimulationPress`.
///
/// Starting goes through [StartSimulationController] (`useStartSimulation`):
/// the modal's "Before you get started" step, then the start call with its
/// 429-retry / active-simulation modals and error toast. The low-credits
/// modal shows for 5 s when credits are low, as on both RN screens.
class LearningPathDetailView extends ConsumerStatefulWidget {
  const LearningPathDetailView({
    super.key,
    required this.details,
    required this.onEnsureSession,
    required this.startParamsFor,
    required this.onViewFeedback,
    this.onRefresh,
  });

  final SimulationPathDetails details;

  /// Creates the path/case session if one doesn't exist yet. Matches the
  /// RN screen's `createSession` — called lazily on the first start/tap,
  /// not eagerly on screen load.
  final Future<void> Function() onEnsureSession;

  /// What to start for a scenario — the path/case item link
  /// (`scenarioPathSessionItemId`/`caseSessionItemId`) and the chosen
  /// language. Given the freshest copy of the scenario (RN's
  /// `freshScenario`): the item's `sessionId` can arrive with the refetch
  /// that follows creating the path/case session.
  final StartSimulationParams Function(PathScenario scenario, int? languageId) startParamsFor;

  /// Resolves a completed scenario's real session id and navigates to its
  /// feedback screen. Matches `handleFileIconPress`.
  final Future<void> Function(PathScenario scenario) onViewFeedback;

  /// Pull-to-refresh (RN's `RefreshControl` → `refetch`).
  final Future<void> Function()? onRefresh;

  @override
  ConsumerState<LearningPathDetailView> createState() =>
      _LearningPathDetailViewState();
}

class _LearningPathDetailViewState
    extends ConsumerState<LearningPathDetailView> {
  bool _isStarting = false;
  String? _error;
  late final StartSimulationController _start = StartSimulationController(ref);

  @override
  void dispose() {
    _start.dispose();
    super.dispose();
  }

  bool get _isStarted => widget.details.completedScenarios > 0;
  bool get _isCompleted => widget.details.completedAt != null;

  Future<void> _startScenario(PathScenario scenario) async {
    // RN creates the path/case session (if one doesn't exist yet) BEFORE
    // opening the preview modal, not after confirming inside it — matches
    // `handleStartPath`/`handleSimulationPress` both calling `createSession`
    // ahead of `setSelectedSimulation`.
    setState(() {
      _isStarting = true;
      _error = null;
    });
    try {
      await widget.onEnsureSession();
    } catch (e) {
      setState(() => _error = '${ref.tr('errors.startSimulation')}: $e');
      return;
    } finally {
      if (mounted) setState(() => _isStarting = false);
    }
    if (!mounted) return;

    await SimulationDetailsModal.show(
      context,
      scenario: scenario,
      onStart: (languageId, close) async {
        final fresh = widget.details.scenarios.where((s) => s.id == scenario.id).firstOrNull;
        await _start.start(context, widget.startParamsFor(fresh ?? scenario, languageId), onSettled: close);
      },
    );
  }

  Future<void> _viewFeedback(PathScenario scenario) async {
    try {
      await widget.onViewFeedback(scenario);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('${ref.tr('errors.loadSession')}: $e')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final details = widget.details;
    final next = details.nextScenario;
    final credits = ref.watch(simulationCreditsProvider).value;
    _start.onCredits(context, credits);
    // RN: !nextSimulation || credits are running low.
    final isStartDisabled = next == null || (credits?.isLow ?? false);

    final list = ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      // RN's styles.scrollContent.
      padding: const EdgeInsets.only(left: 21, right: 21, bottom: 32),
      children: [
        LearningPathListHeader(
          title: details.title,
          description: details.description,
          coverImageUrl: details.coverImageUrl,
          completed: details.completedScenarios,
          total: details.scenarios.length,
          isCompleted: _isCompleted,
          startButtonLabel: _isStarted ? ref.t('common.continue') : ref.t('common.start'),
          onStart: () {
            if (next != null) _startScenario(next);
          },
          isStartDisabled: isStartDisabled,
          isLoading: _isStarting,
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(_error!, style: const TextStyle(color: AppColors.red400)),
          ),
        for (final scenario in details.scenarios)
          _ScenarioRow(
            scenario: scenario,
            isNext: _isStarted && next?.id == scenario.id,
            isStarting: _isStarting,
            onTap: () => _startScenario(scenario),
            onViewFeedback: () => _viewFeedback(scenario),
          ),
      ],
    );

    final onRefresh = widget.onRefresh;
    if (onRefresh == null) return list;
    return RefreshIndicator(onRefresh: onRefresh, child: list);
  }
}

/// RN's `SimulationPathDetailsScreen/components/PathSimulationCard.tsx`: a
/// 120x60 thumbnail (dimmed with a lock when locked), then "Role play N" +
/// completed tick / Next chip over a 2-line title, and a file icon at the
/// right end of completed rows that opens their feedback.
class _ScenarioRow extends ConsumerWidget {
  const _ScenarioRow({
    required this.scenario,
    required this.isNext,
    required this.isStarting,
    required this.onTap,
    required this.onViewFeedback,
  });

  final PathScenario scenario;
  final bool isNext;
  final bool isStarting;
  final VoidCallback onTap;
  final VoidCallback onViewFeedback;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locked = scenario.status == SessionItemStatus.locked;
    final completed = scenario.status == SessionItemStatus.completed;
    final thumb = scenario.coverImageUrl;

    return Material(
      color: Colors.white,
      child: InkWell(
        onTap: locked || isStarting ? null : onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Row(
            children: [
              SizedBox(
                width: 120,
                height: 60,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    if (thumb != null && thumb.isNotEmpty)
                      ClipRRect(
                        borderRadius: BorderRadius.circular(4),
                        child: Image.network(
                          thumb,
                          fit: BoxFit.cover,
                          errorBuilder: (_, _, _) => const ColoredBox(color: AppColors.grey200),
                        ),
                      ),
                    if (locked)
                      DecoratedBox(
                        key: const Key('path-item-locked'),
                        decoration: BoxDecoration(
                          color: AppColors.blackAlpha800,
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Center(
                          child: SvgPicture.asset(
                            'assets/icons/lock.svg',
                            width: 20,
                            height: 20,
                            colorFilter: const ColorFilter.mode(Colors.white, BlendMode.srcIn),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              // styles.card gap 12, then styles.content paddingHorizontal 12.
              const SizedBox(width: 12),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          // styles.orderLabel: ROBOTO.REGULAR + body.small.
                          Text(
                            '${ref.t('postSim.titlePrefix')} ${scenario.order}',
                            style: const TextStyle(
                              fontFamily: AppFonts.robotoRegular,
                              fontSize: 12,
                              height: 16 / 12,
                              letterSpacing: 0.2,
                              color: AppColors.lowEmphasis,
                            ),
                          ),
                          if (completed) ...[
                            const SizedBox(width: 8),
                            SvgPicture.asset('assets/icons/tickRound.svg', width: 16, height: 16),
                          ],
                          if (isNext) ...[
                            const SizedBox(width: 8),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: AppColors.lightBlue50,
                                borderRadius: BorderRadius.circular(16),
                              ),
                              // styles.nextBadgeText: ROBOTO.REGULAR + body.tiny.
                              child: Text(
                                ref.t('common.next'),
                                style: const TextStyle(
                                  fontFamily: AppFonts.robotoRegular,
                                  fontSize: 10,
                                  height: 14 / 10,
                                  letterSpacing: 0.3,
                                  color: AppColors.primary,
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                      const SizedBox(height: 8),
                      // styles.title: IBM_PLEX_SERIF.REGULAR + body.medium.
                      Text(
                        scenario.title ?? '',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontFamily: AppFonts.ibmPlexSerifRegular,
                          fontSize: 14,
                          height: 22 / 14,
                          letterSpacing: 0.2,
                          color: AppColors.highEmphasis,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              if (completed)
                GestureDetector(
                  key: const Key('path-item-feedback'),
                  behavior: HitTestBehavior.opaque,
                  onTap: scenario.sessionId == null ? null : onViewFeedback,
                  child: Padding(
                    // styles.fileIconContainer paddingRight 12, plus RN's
                    // DEFAULT_HIT_SLOP-ish touch area around it.
                    padding: const EdgeInsets.only(left: 8, top: 8, bottom: 8, right: 12),
                    child: Semantics(
                      button: true,
                      label: ref.t('simulations.viewFeedback'),
                      child: SvgPicture.asset('assets/icons/file.svg', width: 18, height: 18),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
