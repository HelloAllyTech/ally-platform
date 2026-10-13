import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../data/course_models.dart';
import '../data/courses_repository.dart';

IconData _iconForType(TrackItemType type) {
  switch (type) {
    case TrackItemType.article:
      return Icons.article_outlined;
    case TrackItemType.video:
      return Icons.play_circle_outline;
    case TrackItemType.quiz:
      return Icons.quiz_outlined;
    case TrackItemType.roleplay:
      return Icons.forum_outlined;
    case TrackItemType.caseItem:
      return Icons.folder_outlined;
    case TrackItemType.journal:
      return Icons.edit_note_outlined;
    case TrackItemType.game:
      return Icons.videogame_asset_outlined;
    case TrackItemType.unknown:
      return Icons.help_outline;
  }
}

/// Track detail — sections + items, with entry into each item. ARTICLE,
/// VIDEO, QUIZ, JOURNAL, and GAME items open the real ported player;
/// ROLEPLAY/CASE route through the existing Simulations/Cases screens
/// instead (not wired from here yet), shown as not-yet-available rather
/// than a broken tap.
class CourseDetailScreen extends ConsumerWidget {
  const CourseDetailScreen({super.key, required this.trackId});

  final String trackId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detailAsync = ref.watch(trackDetailProvider(trackId));

    return Scaffold(
      appBar: AppBar(
        title: detailAsync.maybeWhen(
          data: (detail) => Text(detail.title),
          orElse: () => Text(ref.t('learn.choose.course')),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.bar_chart),
            tooltip: ref.t('courses.viewProgress'),
            onPressed: () => context.push('/courses/$trackId/progress'),
          ),
        ],
      ),
      body: detailAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) =>
            Center(child: Text('${ref.t('courses.notFound')}: $error')),
        data: (detail) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            for (final section in detail.sections) ...[
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text(
                  section.title,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              for (final item in section.items)
                Card(
                  child: ListTile(
                    leading: Icon(_iconForType(item.type)),
                    title: Text(item.title),
                    trailing: item.status == TrackItemStatus.completed
                        ? const Icon(Icons.check_circle, color: Colors.green)
                        : item.status == TrackItemStatus.locked
                            ? const Icon(Icons.lock_outline)
                            : const Icon(Icons.arrow_forward_ios, size: 16),
                    enabled: item.status != TrackItemStatus.locked,
                    onTap: item.status == TrackItemStatus.locked
                        ? null
                        : () {
                            if (item.type == TrackItemType.article ||
                                item.type == TrackItemType.video ||
                                item.type == TrackItemType.quiz ||
                                item.type == TrackItemType.journal ||
                                item.type == TrackItemType.game) {
                              context.push(
                                '/courses/item/${item.id}',
                                extra: item,
                              );
                            } else {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                  content: Text(
                                    ref.tr('courses.player.unsupportedBody'),
                                  ),
                                ),
                              );
                            }
                          },
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }
}
