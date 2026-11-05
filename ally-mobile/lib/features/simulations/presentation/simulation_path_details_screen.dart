import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../data/simulations_repository.dart';
import 'learning_path_detail_view.dart';
import 'simulation_feedback_location.dart';
import 'start_simulation/start_simulation_controller.dart';
import 'widgets/learning_path_widgets.dart';

/// Port of ally-mobile (React Native)'s `SimulationPathDetailsScreen` —
/// same resumption flow as CaseDetailsScreen (continue at the next
/// unlocked/incomplete scenario via `scenarioPathSessionItemId`), per-
/// scenario start, and view-feedback-for-a-completed-scenario action. See
/// [LearningPathDetailView] for the shared body both screens render.
class SimulationPathDetailsScreen extends ConsumerWidget {
  const SimulationPathDetailsScreen({super.key, required this.pathId});

  final String pathId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detailsAsync = ref.watch(simulationPathDetailsProvider(pathId));

    // RN: white screen, LearningPathHeader with the credits read-out, then
    // a large spinner / DataUnavailable EmptyState / the list.
    // RN `handleBack` (header + hardware back): pop, or with nothing to pop
    // (a cold deep link) `navigateToLearnTab`.
    return PopScope(
      canPop: context.canPop(),
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) learningPathBack(context);
      },
      child: Scaffold(
        backgroundColor: Colors.white,
        body: Column(
          children: [
            LearningPathHeader(
              title: ref.t('learn.choose.track'),
              showCredits: true,
              onBack: () => learningPathBack(context),
            ),
            Expanded(
              child: detailsAsync.when(
                loading: () => const LearningPathLoading(),
                error: (_, _) => LearningPathLoadError(
                  title: ref.t('simulationPage.failedToLoadPathDetails'),
                ),
                data: (details) => LearningPathDetailView(
                  details: details,
                  onRefresh: () =>
                      ref.refresh(simulationPathDetailsProvider(pathId).future),
                  onEnsureSession: () async {
                    if (details.scenarioPathSessionId != null) return;
                    await ref
                        .read(simulationsRepositoryProvider)
                        .createPathSession(pathId);
                    ref.invalidate(simulationPathDetailsProvider(pathId));
                  },
                  startParamsFor: (scenario, languageId) =>
                      StartSimulationParams(
                        scenarioId: scenario.scenarioId,
                        scenarioPathSessionItemId: scenario.sessionId,
                        languageId: languageId,
                        pathId: pathId,
                      ),
                  onViewFeedback: (scenario) async {
                    final sessionId = await ref
                        .read(simulationsRepositoryProvider)
                        .getScenarioSessionByPathItem(scenario.sessionId!);
                    if (sessionId == null) return false;
                    if (context.mounted) {
                      // Reviewing an already-completed session (not a fresh
                      // finish) — mirrors RN's own `fromLogs: true` on this exact
                      // call site, so the feedback screen doesn't force a rating
                      // prompt on exit.
                      context.push(
                        simulationFeedbackLocation(
                          sessionId,
                          fromLogs: true,
                          pathId: pathId,
                        ),
                      );
                    }
                    return true;
                  },
                  sessionNotFoundMessage: ref.t(
                    'simulationPage.failedToLoadPathDetails',
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
