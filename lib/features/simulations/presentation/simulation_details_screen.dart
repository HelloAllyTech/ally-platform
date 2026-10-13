import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../data/simulations_repository.dart';

/// Port of ally-mobile (React Native)'s `SimulationDetailsScreen` — scenario
/// detail + "start simulation", which calls the real
/// `scenario-session-start` endpoint and hands the resulting LiveKit
/// url/token to RoleplayVoiceScreen (Phase 1), closing the real
/// scenario → live session → feedback loop end to end.
class SimulationDetailsScreen extends ConsumerStatefulWidget {
  const SimulationDetailsScreen({super.key, required this.scenarioId});

  final int scenarioId;

  @override
  ConsumerState<SimulationDetailsScreen> createState() =>
      _SimulationDetailsScreenState();
}

class _SimulationDetailsScreenState
    extends ConsumerState<SimulationDetailsScreen> {
  bool _isStarting = false;
  String? _error;

  Future<void> _startSimulation() async {
    setState(() {
      _isStarting = true;
      _error = null;
    });
    try {
      final session = await ref
          .read(simulationsRepositoryProvider)
          .startScenarioSession(scenarioId: widget.scenarioId);
      if (mounted) {
        context.push(
          '/roleplay',
          extra: {
            'liveKitServerUrl': session.liveKitServerUrl,
            'accessToken': session.accessToken,
            'scenarioSessionId': session.id,
          },
        );
      }
    } catch (e) {
      setState(() => _error = '${ref.tr('errors.startSimulation')}: $e');
    } finally {
      if (mounted) setState(() => _isStarting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scenarioAsync = ref.watch(scenarioByIdProvider(widget.scenarioId));

    return Scaffold(
      appBar: AppBar(title: Text(ref.t('common.startSimulation'))),
      body: scenarioAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(
          child: Text('${ref.t('learn.details.loadingDetailsError')}: $error'),
        ),
        data: (scenario) => Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                scenario.title,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              if (scenario.description != null) ...[
                const SizedBox(height: 12),
                Text(scenario.description!),
              ],
              if (_error != null) ...[
                const SizedBox(height: 16),
                Text(_error!, style: const TextStyle(color: Colors.red)),
              ],
              const Spacer(),
              FilledButton(
                onPressed: _isStarting ? null : _startSimulation,
                child: _isStarting
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(ref.t('common.startSimulation')),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
