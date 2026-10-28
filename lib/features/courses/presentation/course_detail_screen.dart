import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../../reviews/presentation/review_formatting.dart' show htmlToPlainText;
import '../data/course_models.dart';
import '../data/courses_repository.dart';
import 'course_language_sheet.dart';

/// Mirrors RN's `CourseItemRow.tsx` `TYPE_BADGE_LABEL` — the single-letter
/// code shown in an item's badge circle, not an icon.
String _typeBadgeLabel(TrackItemType type) {
  switch (type) {
    case TrackItemType.roleplay:
      return 'R';
    case TrackItemType.caseItem:
      return 'C';
    case TrackItemType.quiz:
      return 'Q';
    case TrackItemType.article:
      return 'A';
    case TrackItemType.video:
      return 'V';
    case TrackItemType.journal:
      return 'J';
    case TrackItemType.game:
      return 'G';
    case TrackItemType.branchingScenario:
      return 'B';
    case TrackItemType.bucketSort:
      return 'S';
    case TrackItemType.unknown:
      return '?';
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
      // The real "what's next" source of truth — mirrors RN's
      // `handleStartOrContinue`'s `getNextItem({trackId})` call, not a
      // client-side scan of this (possibly now-stale) `detail`.
      final result = await ref.read(coursesRepositoryProvider).getNextTrackItem(detail.id);
      final next = result.nextItem;
      if (result.trackCompleted || next == null) return;
      if (mounted) _openItem(next);
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

  /// Shown only when the course is actually published in more than one
  /// language — a single-language course should not carry a control whose
  /// only option is the one already selected. `null` means no row at all.
  Widget? _buildLanguageRow(TrackDetail detail) {
    final options = detail.availableLanguages;
    if (options.length < 2) return null;
    TrackLanguageOption? current;
    for (final option in options) {
      if (option.languageCode == detail.languageCode) {
        current = option;
        break;
      }
    }
    final label = current != null && current.isSource
        ? current.label
        : getCourseLanguageLabel(detail.languageCode ?? 'en');

    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Expanded(
          child: Text(
            ref.t('courses.language.readingIn', {'language': label}),
            style: const TextStyle(fontSize: 12, color: AppColors.mediumEmphasis),
          ),
        ),
        TextButton(
          key: const Key('course-language-change'),
          onPressed: () => CourseLanguageSheet.show(
            context,
            trackId: detail.id,
            options: options,
            currentLanguageCode: detail.languageCode ?? 'en',
          ),
          child: Text(ref.t('courses.language.change')),
        ),
      ],
    );
  }

  Widget _buildBody(BuildContext context, TrackDetail detail) {
    final isCompleted =
        detail.totalItems > 0 && detail.completedItems >= detail.totalItems;
    final showProgress = detail.completedItems > 0 && detail.totalItems > 0;
    final languageRow = _buildLanguageRow(detail);
    // RN's `findNextItemId` — the one item across the WHOLE course (not
    // just its own section) that gets the "Next" status chip.
    final nextItemId = findNextItemId(detail);

    return RefreshIndicator(
      onRefresh: () => ref.refresh(trackDetailProvider(widget.trackId).future),
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (languageRow != null) ...[languageRow, const SizedBox(height: 12)],
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
          for (var i = 0; i < detail.sections.length; i++) ...[
            _SectionHeader(section: detail.sections[i], index: i),
            for (final item in detail.sections[i].items)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: _CourseItemRow(
                  item: item,
                  isNext: item.id == nextItemId,
                  onTap: item.status == TrackItemStatus.locked
                      ? null
                      : () => _openItem(item),
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

/// RN's `CourseSectionBlock` header row — a circular progress ring (section
/// completion) with the section number centered inside, plus title +
/// subtitle (the section's own description, falling back to "X of Y"
/// completion text).
class _SectionHeader extends ConsumerWidget {
  const _SectionHeader({required this.section, required this.index});

  final TrackSection section;
  final int index;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final total = section.items.length;
    final completedCount =
        section.items.where((item) => item.status == TrackItemStatus.completed).length;
    final progress = total > 0 ? completedCount / total : 0.0;
    final plainDescription = htmlToPlainText(section.description);
    final subtitle = plainDescription.isNotEmpty
        ? plainDescription
        : ref.t('courses.progress', {'completed': completedCount, 'total': total});

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          SizedBox(
            width: 44,
            height: 44,
            child: Stack(
              alignment: Alignment.center,
              children: [
                CircularProgressIndicator(
                  value: progress.clamp(0.0, 1.0),
                  strokeWidth: 3,
                  backgroundColor: AppColors.strokePrimary,
                  valueColor: const AlwaysStoppedAnimation(AppColors.primary),
                ),
                Text(
                  '${index + 1}',
                  style: const TextStyle(
                    fontFamily: AppFonts.ibmPlexSerifMedium,
                    color: AppColors.highEmphasis,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // RN's CourseSectionBlock styles.sectionTitle:
                // IBM_PLEX_SERIF.MEDIUM at body.large size (16/24/0.5) —
                // bodyLarge already matches that size exactly.
                Text(
                  section.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodyLarge
                      ?.copyWith(fontFamily: AppFonts.ibmPlexSerifMedium),
                ),
                Text(
                  subtitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12, color: AppColors.mediumEmphasis),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// RN's `CourseItemRow` — a badge circle (type letter, or a lock icon once
/// locked; solid primary once completed), title row (checkmark when
/// completed, else an "In progress"/"Next" chip when applicable), the
/// per-type meta line (`getTrackItemMeta`), and optional locked/
/// language-fallback captions.
class _CourseItemRow extends ConsumerWidget {
  const _CourseItemRow({required this.item, required this.isNext, required this.onTap});

  final TrackDetailItem item;
  final bool isNext;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isLocked = item.status == TrackItemStatus.locked;
    final isCompleted = item.status == TrackItemStatus.completed;
    final isInProgress = item.status == TrackItemStatus.unlocked &&
        (item.startedAt?.isNotEmpty ?? false);
    final isCurrent = isNext || isInProgress;

    String? statusLabel;
    if (!isCompleted) {
      if (isInProgress) {
        statusLabel = ref.t('courses.status.inProgress');
      } else if (isNext) {
        statusLabel = ref.t('common.next');
      }
    }

    final meta = trackItemMetaText(item, ref.t);
    final languageFallbackReason = item.languageFallbackReason;

    return InkWell(
      key: ValueKey('item-row-${item.id}'),
      borderRadius: BorderRadius.circular(14),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: isLocked ? AppColors.lightGray : Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: !isLocked && isCurrent ? AppColors.primary : AppColors.strokePrimary,
            width: !isLocked && isCurrent ? 1.5 : 1,
          ),
        ),
        child: Opacity(
          opacity: isLocked ? 0.7 : 1,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 40,
                height: 40,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: isCompleted
                      ? AppColors.primary
                      : isLocked
                      ? AppColors.lightGray
                      : Colors.white,
                  border: Border.all(
                    color: isLocked ? AppColors.strokePrimary : AppColors.primary,
                    width: 1.5,
                  ),
                ),
                child: isLocked
                    ? SvgPicture.asset(
                        'assets/icons/lock.svg',
                        key: const ValueKey('item-badge-locked'),
                        width: 16,
                        height: 16,
                        colorFilter: const ColorFilter.mode(AppColors.grey400, BlendMode.srcIn),
                      )
                    : Text(
                        _typeBadgeLabel(item.type),
                        style: TextStyle(
                          fontFamily: AppFonts.ibmPlexSerifMedium,
                          fontSize: 14,
                          color: isCompleted ? Colors.white : AppColors.primary,
                        ),
                      ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Expanded(
                          child: Text(
                            item.title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const SizedBox(width: 8),
                        if (isCompleted)
                          SvgPicture.asset(
                            'assets/icons/checkCircle.svg',
                            key: const ValueKey('item-check-completed'),
                            width: 16,
                            height: 16,
                          )
                        else if (statusLabel != null)
                          Container(
                            key: const ValueKey('item-status-chip'),
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: AppColors.lightBlue50,
                              borderRadius: BorderRadius.circular(16),
                            ),
                            child: Text(
                              statusLabel,
                              style: const TextStyle(color: AppColors.primary, fontSize: 11),
                            ),
                          ),
                      ],
                    ),
                    if (meta.isNotEmpty)
                      Text(
                        meta,
                        style: const TextStyle(color: AppColors.mediumEmphasis, fontSize: 12),
                      ),
                    // A component the trainer could not localise — say so on
                    // the card rather than surprising the learner once it
                    // opens.
                    if (languageFallbackReason != null)
                      Text(
                        ref.t('courses.language.fallback.$languageFallbackReason'),
                        style: const TextStyle(color: AppColors.mediumEmphasis, fontSize: 11),
                      ),
                    if (isLocked)
                      Text(
                        ref.t('courses.lockedTooltip'),
                        key: const ValueKey('item-locked-caption'),
                        style: const TextStyle(color: AppColors.lowEmphasis, fontSize: 11),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
