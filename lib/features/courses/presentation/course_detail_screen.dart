import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/tab_screen_header.dart';
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
      body: Column(
        children: [
          TabScreenHeader(
            title: detailAsync.maybeWhen(
              data: (detail) => detail.title,
              orElse: () => ref.t('learn.choose.course'),
            ),
            trailing: IconButton(
              icon: const Icon(Icons.bar_chart),
              tooltip: ref.t('courses.viewProgress'),
              onPressed: () => context.push('/courses/$trackId/progress'),
            ),
          ),
          Expanded(
            child: detailAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, _) =>
                  Center(child: Text('${ref.t('courses.notFound')}: $error')),
              data: (detail) => ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  for (final section in detail.sections) ...[
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      // RN's CourseSectionBlock styles.sectionTitle:
                      // IBM_PLEX_SERIF.MEDIUM at body.large size (16/24/0.5)
                      // — bodyLarge already matches that size exactly.
                      child: Text(
                        section.title,
                        style: Theme.of(context)
                            .textTheme
                            .bodyLarge
                            ?.copyWith(fontFamily: AppFonts.ibmPlexSerifMedium),
                      ),
                    ),
                    for (final item in section.items)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: AppCard(
                          variant: AppCardVariant.flat,
                          child: ListTile(
                            leading: Icon(_iconForType(item.type)),
                            title: Text(item.title),
                            trailing: item.status == TrackItemStatus.completed
                                ? SvgPicture.asset(
                                    'assets/icons/checkCircle.svg',
                                    key: const ValueKey('trailing-completed'),
                                    width: 24,
                                    height: 24,
                                  )
                                : item.status == TrackItemStatus.locked
                                    ? SvgPicture.asset(
                                        'assets/icons/lock.svg',
                                        key: const ValueKey('trailing-locked'),
                                        width: 20,
                                        height: 20,
                                      )
                                    : SvgPicture.asset(
                                        'assets/icons/arrowRight.svg',
                                        key: const ValueKey('trailing-unlocked'),
                                        width: 16,
                                        height: 16,
                                      ),
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
                      ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
