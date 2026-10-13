import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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
      appBar: AppBar(title: const Text('Progress')),
      body: progressAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(child: Text('Failed to load progress: $error')),
        data: (progress) => Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(progress.title, style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 24),
              LinearProgressIndicator(value: progress.completionPct / 100),
              const SizedBox(height: 8),
              Text('${progress.completionPct.toStringAsFixed(0)}% complete'),
              Text('${progress.completedItems} of ${progress.totalItems} items'),
            ],
          ),
        ),
      ),
    );
  }
}
