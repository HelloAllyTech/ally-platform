import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../data/simulations_repository.dart';

/// Port of ally-mobile (React Native)'s `CaseDetailsScreen`. Cases are
/// structurally identical to scenario paths in the backend contract (RN's
/// `src/types/simulations.ts` defines `CaseDetails = SimulationPathDetails`
/// as a literal type alias), so this reuses the same models and a near-
/// identical layout to SimulationPathDetailsScreen, just pointed at
/// `/learn/cases` instead of `/learn/scenario-paths`.
class CaseDetailsScreen extends ConsumerWidget {
  const CaseDetailsScreen({super.key, required this.caseId});

  final String caseId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detailsAsync = ref.watch(caseDetailsProvider(caseId));

    return Scaffold(
      appBar: AppBar(title: const Text('Case')),
      body: detailsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(child: Text('Failed to load case: $error')),
        data: (details) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (details.title != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(details.title!, style: Theme.of(context).textTheme.headlineSmall),
              ),
            Text('${details.completedScenarios}/${details.scenarios.length} completed'),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: () async {
                await ref.read(simulationsRepositoryProvider).createCaseSession(caseId);
                ref.invalidate(caseDetailsProvider(caseId));
              },
              child: const Text('Start case'),
            ),
            const SizedBox(height: 16),
            for (final scenario in details.scenarios)
              Card(
                child: ListTile(
                  leading: CircleAvatar(child: Text('${scenario.order}')),
                  title: Text(scenario.title ?? 'Scenario ${scenario.scenarioId}'),
                  subtitle: scenario.description != null ? Text(scenario.description!) : null,
                  onTap: () => context.push('/simulations/${scenario.scenarioId}'),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
