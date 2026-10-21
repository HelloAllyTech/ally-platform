import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';
import '../data/courses_repository.dart';

/// Scoped port of ally-mobile (React Native)'s `CourseProgressScreen`.
/// `TrackProgressDashboard` carries skill-category feedback aggregated
/// across roleplay sessions in the real RN type (`TrackProgressDashboard`
/// in `src/types/courses.ts`) — not modeled yet here, since it depends on
/// the roleplay/feedback feature area this phase doesn't cover. This screen
/// shows the completion summary only.
class CourseProgressScreen extends ConsumerWidget {
  const CourseProgressScreen({super.key, required this.trackId});

  final String trackId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final progressAsync = ref.watch(trackProgressProvider(trackId));

    return Scaffold(
      appBar: AppBar(title: Text(ref.t('courses.progressDashboard.title'))),
      body: progressAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(
          child: Text('${ref.t('courses.progressDashboard.notFound')}: $error'),
        ),
        data: (progress) => Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // RN's `CourseProgressBody` never renders the track's own
              // title anywhere — confirmed by reading the real component:
              // it goes straight from the header (already static "Progress"
              // above) into the progress bar. No title heading in the body.
              LinearProgressIndicator(value: progress.completionPct / 100),
              const SizedBox(height: 8),
              Text(ref.t('courses.player.overallProgress', {
                'pct': progress.completionPct.toStringAsFixed(0),
              })),
              Text(ref.t('simulations.progressCompleted', {
                'current': progress.completedItems,
                'total': progress.totalItems,
              })),
            ],
          ),
        ),
      ),
    );
  }
}
