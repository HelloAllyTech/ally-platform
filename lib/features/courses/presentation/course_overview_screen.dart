import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../data/courses_repository.dart';

/// Ported from ally-mobile (React Native)'s `CourseOverviewScreen` — the
/// track list + enroll action. Card layout/design tokens are a later pass
/// (see AppTheme's own scope note); this screen is scoped to real data flow:
/// list tracks, show progress, enroll, navigate into a track's items.
class CourseOverviewScreen extends ConsumerWidget {
  const CourseOverviewScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tracksAsync = ref.watch(learnTracksProvider);

    return Scaffold(
      body: Column(
        children: [
          TabScreenHeader(title: ref.t('learn.tabs.courses')),
          Expanded(
            child: tracksAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, _) =>
                  Center(child: Text('${ref.t('courses.listLoadFailed')}: $error')),
              data: (tracks) {
                if (tracks.isEmpty) {
                  return Center(child: Text(ref.t('simulationPage.noCoursesAvailable')));
                }
                return RefreshIndicator(
                  onRefresh: () => ref.refresh(learnTracksProvider.future),
                  child: ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: tracks.length,
                    itemBuilder: (context, index) {
                      final track = tracks[index];
                      final progress = track.totalItems == 0
                          ? 0.0
                          : track.completedItems / track.totalItems;
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: AppCard(
                          child: ListTile(
                            // RN renders this via the shared SimulationCard
                            // component (title: IBM_PLEX_SERIF.MEDIUM) —
                            // ListTile's default title is IBMPlexSerif but
                            // Regular weight.
                            title: Text(
                              track.title,
                              style: Theme.of(context)
                                  .textTheme
                                  .titleMedium
                                  ?.copyWith(fontFamily: AppFonts.ibmPlexSerifMedium),
                            ),
                            subtitle: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                if (track.description != null) Text(track.description!),
                                const SizedBox(height: 8),
                                LinearProgressIndicator(value: progress),
                                Text(ref.t('simulations.progressCompleted', {
                                  'current': track.completedItems,
                                  'total': track.totalItems,
                                })),
                              ],
                            ),
                            trailing: track.enrolled
                                ? SvgPicture.asset(
                                    'assets/icons/arrowRight.svg',
                                    width: 16,
                                    height: 16,
                                  )
                                // Not AppButton here: it's always full-bleed
                                // width in its container (matching the real
                                // RN Button component, which is the same),
                                // which doesn't fit a ListTile's trailing
                                // slot — that's a real constraint mismatch,
                                // not something to force around.
                                : TextButton(
                                    onPressed: () async {
                                      await ref
                                          .read(coursesRepositoryProvider)
                                          .enrollTrack(track.id);
                                      ref.invalidate(learnTracksProvider);
                                    },
                                    child: Text(ref.t('courses.enroll')),
                                  ),
                            onTap: track.enrolled
                                ? () => context.push('/courses/${track.id}')
                                : null,
                          ),
                        ),
                      );
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
