import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/tab_screen_header.dart';
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
      body: Column(
        children: [
          TabScreenHeader(title: ref.t('common.startSimulation')),
          Expanded(
            child: scenarioAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, _) => Center(
                child: Text('${ref.t('learn.details.loadingDetailsError')}: $error'),
              ),
              data: (scenario) => Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // RN's styles.cardTitle: IBM_PLEX_SERIF.MEDIUM at 20px —
                    // not headlineSmall's ReplayPro-Headline at 24px (that's
                    // the screen's own pageTitle, a different element).
                    Text(
                      scenario.title,
                      style: const TextStyle(
                        fontFamily: AppFonts.ibmPlexSerifMedium,
                        fontSize: 20,
                        color: AppColors.highEmphasis,
                      ),
                    ),
                    if (scenario.description != null) ...[
                      const SizedBox(height: 12),
                      Text(scenario.description!),
                    ],
                    if (_error != null) ...[
                      const SizedBox(height: 16),
                      Text(_error!, style: const TextStyle(color: AppColors.red400)),
                    ],
                    const Spacer(),
                    AppButton(
                      label: ref.t('common.startSimulation'),
                      isLoading: _isStarting,
                      onPressed: _startSimulation,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
