import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/tab_screen_header.dart';
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
      body: Column(
        children: [
          TabScreenHeader(
            title: ref.t('common.appName'),
            subtitle: ref.t('nav.tabs.learn'),
            italicSubtitle: true,
            trailing: creditsAsync.when(
              // RN's styles.creditText: display.small size, but
              // IBM_PLEX_SERIF.MEDIUM family — not the ambient default.
              data: (credits) => Text(
                ref.t('simulations.creditsRemaining', {'count': credits.remaining}),
                style: Theme.of(context)
                    .textTheme
                    .displaySmall
                    ?.copyWith(fontFamily: AppFonts.ibmPlexSerifMedium),
              ),
              loading: () => const SizedBox.shrink(),
              error: (_, _) => const SizedBox.shrink(),
            ),
          ),
          Expanded(
            child: scenariosAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, _) => Center(
                child: Text('${ref.t('simulations.failedToLoadScenarios')}: $error'),
              ),
              data: (scenarios) {
                if (scenarios.isEmpty) {
                  return Center(child: Text(ref.t('simulationPage.noSimulationsAvailable')));
                }
                return ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: scenarios.length,
                  itemBuilder: (context, index) {
                    final scenario = scenarios[index];
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: AppCard(
                        child: ListTile(
                          // RN's shared SimulationCard: title is
                          // IBM_PLEX_SERIF.MEDIUM — ListTile's default
                          // title style is IBMPlexSerif but Regular weight.
                          title: Text(
                            scenario.title,
                            style: Theme.of(context)
                                .textTheme
                                .titleMedium
                                ?.copyWith(fontFamily: AppFonts.ibmPlexSerifMedium),
                          ),
                          subtitle: scenario.description != null
                              ? Text(
                                  scenario.description!,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                )
                              : null,
                          trailing: SvgPicture.asset(
                            'assets/icons/arrowRight.svg',
                            width: 16,
                            height: 16,
                          ),
                          onTap: () => context.push('/simulations/${scenario.id}'),
                        ),
                      ),
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
