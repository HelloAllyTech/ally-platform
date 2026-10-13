import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../data/simulations_repository.dart';

/// List entry point for CaseDetailsScreen — ally-mobile (React Native)
/// reaches cases via a learning-path-style list; this mirrors
/// SimulationPathDetailsScreen's list pattern since cases share the same
/// SimulationPath model.
class CasesListScreen extends ConsumerWidget {
  const CasesListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final casesAsync = ref.watch(casesProvider);

    return Scaffold(
      appBar: AppBar(title: Text(ref.t('simulations.cases'))),
      body: casesAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(
          child: Text('${ref.t('simulations.failedToLoadCases')}: $error'),
        ),
        data: (cases) {
          if (cases.isEmpty) {
            return Center(child: Text(ref.t('simulationPage.noCasesAvailable')));
          }
          return ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: cases.length,
            itemBuilder: (context, index) {
              final caseItem = cases[index];
              return Card(
                margin: const EdgeInsets.only(bottom: 12),
                child: ListTile(
                  title: Text(caseItem.title),
                  subtitle: caseItem.description != null
                      ? Text(caseItem.description!)
                      : null,
                  trailing: Text(
                    '${caseItem.completedScenarios}/${caseItem.totalScenarios}',
                  ),
                  onTap: () => context.push('/cases/${caseItem.id}'),
                ),
              );
            },
          );
        },
      ),
    );
  }
}
