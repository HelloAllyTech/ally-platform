import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../data/simulations_repository.dart';
import 'learning_path_detail_view.dart';
import 'widgets/learning_path_widgets.dart';

/// Port of ally-mobile (React Native)'s `CaseDetailsScreen`. Cases are
/// structurally identical to scenario paths in the backend contract (RN's
/// `src/types/simulations.ts` defines `CaseDetails = SimulationPathDetails`
/// as a literal type alias), so this reuses the same models and
/// [LearningPathDetailView] as SimulationPathDetailsScreen, just pointed at
/// `/learn/cases` instead of `/learn/scenario-paths` — same resumption
/// flow (continue at the next unlocked/incomplete scenario), per-scenario
/// start, and view-feedback-for-a-completed-scenario action.
class CaseDetailsScreen extends ConsumerWidget {
  const CaseDetailsScreen({super.key, required this.caseId});

  final String caseId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detailsAsync = ref.watch(caseDetailsProvider(caseId));

    // RN: white screen, LearningPathHeader with the credits read-out, then
    // a large spinner / DataUnavailable EmptyState / the list.
    return Scaffold(
      backgroundColor: Colors.white,
      body: Column(
        children: [
          LearningPathHeader(
            title: ref.t('learn.choose.case'),
            showCredits: true,
          ),
          Expanded(
            child: detailsAsync.when(
              loading: () => const LearningPathLoading(),
              error: (_, _) => LearningPathLoadError(
                title: ref.t('simulationPage.failedToLoadCaseDetails'),
              ),
              data: (details) => LearningPathDetailView(
                details: details,
                onRefresh: () =>
                    ref.refresh(caseDetailsProvider(caseId).future),
                onEnsureSession: () async {
                  if (details.caseSessionId != null) return;
                  await ref
                      .read(simulationsRepositoryProvider)
                      .createCaseSession(caseId);
                  ref.invalidate(caseDetailsProvider(caseId));
                },
                onStartScenario: (scenario, {languageId}) async {
                  final session = await ref
                      .read(simulationsRepositoryProvider)
                      .startScenarioSession(
                        scenarioId: scenario.scenarioId,
                        caseSessionItemId: scenario.sessionId,
                        languageId: languageId,
                      );
                  if (context.mounted) {
                    context.push(
                      '/roleplay',
                      extra: {
                        'liveKitServerUrl': session.liveKitServerUrl,
                        'accessToken': session.accessToken,
                        'scenarioSessionId': session.id,
                      },
                    );
                  }
                },
                onViewFeedback: (scenario) async {
                  final sessionId = await ref
                      .read(simulationsRepositoryProvider)
                      .getScenarioSessionByCaseItem(scenario.sessionId!);
                  if (sessionId != null && context.mounted) {
                    // Reviewing an already-completed session (not a fresh
                    // finish) — mirrors RN's own `fromLogs: true` on this exact
                    // call site, so the feedback screen doesn't force a rating
                    // prompt on exit.
                    context.push(
                      '/simulations/feedback/$sessionId?fromLogs=true',
                    );
                  }
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}
