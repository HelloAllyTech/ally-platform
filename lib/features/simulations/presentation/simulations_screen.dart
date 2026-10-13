import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../data/simulations_repository.dart';

/// Port of ally-mobile (React Native)'s `SimulationsScreen` — scenario list
/// + remaining credits.
class SimulationsScreen extends ConsumerWidget {
  const SimulationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scenariosAsync = ref.watch(scenariosProvider);
    final creditsAsync = ref.watch(simulationCreditsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Simulations'),
        actions: [
          creditsAsync.when(
            data: (credits) => Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Center(child: Text('${credits.remaining} credits')),
            ),
            loading: () => const SizedBox.shrink(),
            error: (_, _) => const SizedBox.shrink(),
          ),
        ],
      ),
      body: scenariosAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(child: Text('Failed to load scenarios: $error')),
        data: (scenarios) {
          if (scenarios.isEmpty) {
            return const Center(child: Text('No scenarios available yet.'));
          }
          return ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: scenarios.length,
            itemBuilder: (context, index) {
              final scenario = scenarios[index];
              return Card(
                margin: const EdgeInsets.only(bottom: 12),
                child: ListTile(
                  title: Text(scenario.title),
                  subtitle: scenario.description != null
                      ? Text(scenario.description!, maxLines: 2, overflow: TextOverflow.ellipsis)
                      : null,
                  trailing: const Icon(Icons.arrow_forward_ios, size: 16),
                  onTap: () => context.push('/simulations/${scenario.id}'),
                ),
              );
            },
          );
        },
      ),
    );
  }
}
