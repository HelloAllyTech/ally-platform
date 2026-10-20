import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../data/simulation_models.dart';

/// Shared body for CaseDetailsScreen and SimulationPathDetailsScreen — ally-
/// mobile (React Native)'s `useLearningPathDetails` hook backs both with
/// "identical logic" (its own doc comment), and `Case`/`CaseDetails` are
/// literal type aliases of `SimulationPath`/`SimulationPathDetails`, so one
/// widget here avoids duplicating the resumption flow twice.
///
/// Renders: title/description, a Start/Continue button that resumes at
/// [SimulationPathDetails.nextScenario] (same definition as the RN
/// screen's `nextSimulation`), and the scenario list with per-status
/// affordances — locked (disabled), completed (view-feedback action),
/// unlocked (tap to start that specific scenario, not just the next one).
///
/// Not ported: the active-simulation-conflict modal and 429-rate-limit
/// retry modal (`useStartSimulation`'s `showActiveSimulationModal`/
/// `showRetryModal`) — those need the backend error body's `entityId`
/// parsed out of a Dio exception, real further work; failures here just
/// surface as a SnackBar. Low-credits warning modal also not ported.
class LearningPathDetailView extends ConsumerStatefulWidget {
  const LearningPathDetailView({
    super.key,
    required this.details,
    required this.onEnsureSession,
    required this.onStartScenario,
    required this.onViewFeedback,
  });

  final SimulationPathDetails details;

  /// Creates the path/case session if one doesn't exist yet. Matches the
  /// RN screen's `createSession` — called lazily on the first start/tap,
  /// not eagerly on screen load.
  final Future<void> Function() onEnsureSession;

  final Future<void> Function(PathScenario scenario) onStartScenario;

  /// Resolves a completed scenario's real session id and navigates to its
  /// feedback screen. Matches `handleFileIconPress`.
  final Future<void> Function(PathScenario scenario) onViewFeedback;

  @override
  ConsumerState<LearningPathDetailView> createState() => _LearningPathDetailViewState();
}

class _LearningPathDetailViewState extends ConsumerState<LearningPathDetailView> {
  bool _isStarting = false;
  String? _error;

  bool get _isStarted => widget.details.completedScenarios > 0;
  bool get _isCompleted => widget.details.completedAt != null;

  Future<void> _startScenario(PathScenario scenario) async {
    setState(() {
      _isStarting = true;
      _error = null;
    });
    try {
      await widget.onEnsureSession();
      await widget.onStartScenario(scenario);
    } catch (e) {
      setState(() => _error = '${ref.tr('errors.startSimulation')}: $e');
    } finally {
      if (mounted) setState(() => _isStarting = false);
    }
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

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (details.title != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            // RN's LearningPathListHeader styles.pathTitle: display.small
            // size, but IBM_PLEX_SERIF.MEDIUM family — not headlineSmall's
            // ReplayPro-Headline (that's a different, larger element).
            child: Text(
              details.title!,
              style: Theme.of(context)
                  .textTheme
                  .displaySmall
                  ?.copyWith(fontFamily: AppFonts.ibmPlexSerifMedium),
            ),
          ),
        if (details.description != null) ...[
          Text(details.description!),
          const SizedBox(height: 8),
        ],
        Text(
          ref.t('learn.details.progress', {
            'completed': details.completedScenarios,
            'total': details.scenarios.length,
          }),
        ),
        if (_isCompleted) ...[
          const SizedBox(height: 4),
          Row(
            children: [
              const Icon(Icons.check_circle, color: Colors.green, size: 18),
              const SizedBox(width: 6),
              Text(ref.t('simulations.completed_one')),
            ],
          ),
        ],
        const SizedBox(height: 12),
        AppButton(
          label: _isStarted ? ref.t('common.continue') : ref.t('common.start'),
          isDisabled: next == null,
          isLoading: _isStarting,
          onPressed: next == null ? null : () => _startScenario(next),
        ),
        if (_error != null) ...[
          const SizedBox(height: 8),
          Text(_error!, style: const TextStyle(color: AppColors.red400)),
        ],
        const SizedBox(height: 16),
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
  }
}

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

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: AppCard(
        variant: AppCardVariant.flat,
        child: ListTile(
          tileColor: isNext ? Theme.of(context).colorScheme.primaryContainer : null,
          leading: CircleAvatar(
            child: locked
                ? const Icon(Icons.lock_outline, size: 18)
                : completed
                ? const Icon(Icons.check, size: 18)
                : Text('${scenario.order}'),
          ),
          title: Text(
            scenario.title ??
                ref.t('simulations.scenarioFallbackTitle', {'id': scenario.scenarioId}),
          ),
          subtitle: scenario.description != null
              ? Text(scenario.description!)
              : null,
          trailing: completed && scenario.sessionId != null
              ? IconButton(
                  icon: const Icon(Icons.description_outlined),
                  tooltip: ref.t('simulations.viewFeedback'),
                  onPressed: onViewFeedback,
                )
              : null,
          enabled: !locked && !isStarting,
          onTap: locked ? null : onTap,
        ),
      ),
    );
  }
}
