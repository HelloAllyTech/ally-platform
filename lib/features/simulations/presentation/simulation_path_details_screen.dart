import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../data/simulations_repository.dart';

/// Port of ally-mobile (React Native)'s `SimulationPathDetailsScreen` —
/// an ordered list of scenarios within a path, each navigable into
/// SimulationDetailsScreen. Path-session-specific start (via
/// `scenarioPathSessionItemId`, which threads a path session through the
/// scenario start call) is not wired yet — tapping a scenario here starts
/// it as a standalone session, same as from SimulationsScreen.
class SimulationPathDetailsScreen extends ConsumerWidget {
  const SimulationPathDetailsScreen({super.key, required this.pathId});

  final String pathId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detailsAsync = ref.watch(simulationPathDetailsProvider(pathId));

    return Scaffold(
      appBar: AppBar(title: const Text('Learning path')),
      body: detailsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(child: Text('Failed to load path: $error')),
        data: (details) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (details.title != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(details.title!, style: Theme.of(context).textTheme.headlineSmall),
              ),
            Text('${details.completedScenarios}/${details.scenarios.length} completed'),
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
