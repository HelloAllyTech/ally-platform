import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/app_button.dart';
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
    case TrackItemType.branchingScenario:
      return Icons.call_split_outlined;
    case TrackItemType.bucketSort:
      return Icons.move_to_inbox_outlined;
    case TrackItemType.unknown:
      return Icons.help_outline;
  }
}

/// Track detail — sections + items, with entry into each item. ARTICLE,
/// VIDEO, QUIZ, JOURNAL, GAME, BRANCHING_SCENARIO, and BUCKET_SORT items
/// open the real ported player;
/// ROLEPLAY/CASE route through the existing Simulations/Cases screens
/// instead (not wired from here yet), shown as not-yet-available rather
/// than a broken tap.
class CourseDetailScreen extends ConsumerStatefulWidget {
  const CourseDetailScreen({super.key, required this.trackId});

  final String trackId;

  @override
  ConsumerState<CourseDetailScreen> createState() => _CourseDetailScreenState();
}

class _CourseDetailScreenState extends ConsumerState<CourseDetailScreen> {
  bool _isStarting = false;
  String? _error;

  void _openItem(TrackDetailItem item) {
    if (isPlayableTrackItemType(item.type)) {
      context.push(
        '/courses/item/${item.id}',
        extra: (trackId: widget.trackId, item: item),
      );
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(ref.tr('courses.player.unsupportedBody'))),
      );
    }
  }

  Future<void> _startOrContinue(TrackDetail detail) async {
    setState(() {
      _isStarting = true;
      _error = null;
    });
    try {
      if (!detail.enrolled) {
        await ref.read(coursesRepositoryProvider).enrollTrack(detail.id);
        ref.invalidate(trackDetailProvider(detail.id));
      }
      final next = nextUnlockedItem(detail);
      if (next != null && mounted) _openItem(next);
    } catch (e) {
      setState(() => _error = '${ref.tr('errors.startSimulation')}: $e');
    } finally {
      if (mounted) setState(() => _isStarting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final detailAsync = ref.watch(trackDetailProvider(widget.trackId));

    return Scaffold(
      body: Column(
        children: [
          TabScreenHeader(
            // RN's CourseOverviewScreen header is always the static
            // "Course" label (`learn.choose.course`) — the track's own
            // title renders in the body banner below, not here.
            title: ref.t('learn.choose.course'),
          ),
          Expanded(
            child: detailAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, _) =>
                  Center(child: Text('${ref.t('courses.notFound')}: $error')),
              data: (detail) => _buildBody(context, detail),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBody(BuildContext context, TrackDetail detail) {
    final isCompleted =
        detail.totalItems > 0 && detail.completedItems >= detail.totalItems;
    final showProgress = detail.completedItems > 0 && detail.totalItems > 0;

    return RefreshIndicator(
      onRefresh: () => ref.refresh(trackDetailProvider(widget.trackId).future),
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (detail.coverImageUrl != null)
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: Image.network(
                detail.coverImageUrl!,
                height: 177,
                width: double.infinity,
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) =>
                    Container(height: 177, color: AppColors.lightGray2),
              ),
            )
          else
            Container(
              height: 177,
              decoration: BoxDecoration(
                color: AppColors.lightGray2,
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          const SizedBox(height: 12),
          // RN's LearningPathListHeader styles.pathTitle: display.small size,
          // but IBM_PLEX_SERIF.MEDIUM family — not displaySmall's
          // ReplayPro-Headline (that's a different, larger element).
          Text(
            detail.title,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.displaySmall
                ?.copyWith(fontFamily: AppFonts.ibmPlexSerifMedium),
          ),
          if (detail.description != null) ...[
            const SizedBox(height: 4),
            Text(detail.description!),
          ],
          if (showProgress) ...[
            const SizedBox(height: 12),
            _ProgressSection(
              detail: detail,
              onTap: detail.enrolled
                  ? () => context.push('/courses/${widget.trackId}/progress')
                  : null,
            ),
          ],
          if (!isCompleted) ...[
            const SizedBox(height: 12),
            AppButton(
              label: (!detail.enrolled || detail.completedItems == 0)
                  ? ref.t('common.start')
                  : ref.t('common.continue'),
              isLoading: _isStarting,
              onPressed: () => _startOrContinue(detail),
            ),
          ],
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(_error!, style: const TextStyle(color: AppColors.red400)),
          ],
          const SizedBox(height: 16),
          for (final section in detail.sections) ...[
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              // RN's CourseSectionBlock styles.sectionTitle:
              // IBM_PLEX_SERIF.MEDIUM at body.large size (16/24/0.5)
              // — bodyLarge already matches that size exactly.
              child: Text(
                section.title,
                style: Theme.of(context).textTheme.bodyLarge
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
                        : () => _openItem(item),
                  ),
                ),
              ),
          ],
        ],
      ),
    );
  }
}

/// RN's `ProgressBar` — a track+fill bar (green once complete, primary
/// while in progress) with "X of Y completed" text, optionally tappable
/// with a chevron + hint when a progress dashboard exists to jump to.
class _ProgressSection extends ConsumerWidget {
  const _ProgressSection({required this.detail, required this.onTap});

  final TrackDetail detail;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fraction = detail.completedItems / detail.totalItems;
    final isComplete = detail.completedItems >= detail.totalItems;

    final content = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(3),
          child: LinearProgressIndicator(
            value: fraction.clamp(0, 1),
            minHeight: 6,
            backgroundColor: AppColors.lightGray2,
            color: isComplete ? Colors.green : AppColors.primary,
          ),
        ),
        const SizedBox(height: 4),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              ref.t('simulations.progressCompleted', {
                'current': detail.completedItems,
                'total': detail.totalItems,
              }),
            ),
            if (onTap != null)
              const Icon(
                Icons.chevron_right,
                size: 18,
                color: AppColors.mediumEmphasis,
              ),
          ],
        ),
        if (onTap != null)
          Text(
            ref.t('courses.progressDashboard.tapHint'),
            style: Theme.of(context).textTheme.bodySmall
                ?.copyWith(color: AppColors.mediumEmphasis),
          ),
      ],
    );

    if (onTap == null) return content;
    return InkWell(onTap: onTap, child: content);
  }
}
