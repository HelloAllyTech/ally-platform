import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../data/simulations_repository.dart';
import 'learning_path_detail_view.dart';

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

    return Scaffold(
      appBar: AppBar(title: Text(ref.t('learn.choose.case'))),
      body: detailsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(
          child: Text('${ref.t('simulationPage.failedToLoadCaseDetails')}: $error'),
        ),
        data: (details) => LearningPathDetailView(
          details: details,
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
              context.push('/simulations/feedback/$sessionId');
            }
          },
        ),
      ),
    );
  }
}
