import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
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
      appBar: AppBar(title: Text(ref.t('learn.tabs.courses'))),
      body: tracksAsync.when(
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
                return Card(
                  margin: const EdgeInsets.only(bottom: 12),
                  child: ListTile(
                    title: Text(track.title),
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
                        ? const Icon(Icons.arrow_forward_ios, size: 16)
                        : FilledButton(
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
                );
              },
            ),
          );
        },
      ),
    );
  }
}
