import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/html_rich_text.dart';
import '../../simulations/presentation/widgets/circular_progress.dart';
import '../../simulations/presentation/widgets/learning_path_widgets.dart';
import '../data/course_models.dart';
import '../data/courses_repository.dart';
import 'course_language_sheet.dart';
import 'course_progress_screen.dart';

/// Port of ally-mobile (React Native)'s `CourseOverviewScreen` (header,
/// language row, LearningPathListHeader, CourseSectionBlock/CourseItemRow).
/// Track detail — sections + items, with entry into each item. ARTICLE,
/// VIDEO, QUIZ, JOURNAL, GAME, BRANCHING_SCENARIO, BUCKET_SORT, ROLEPLAY and
/// CASE items open the real ported player (ROLEPLAY/CASE via RN's
/// `RoleplayCasePlayer`).
class CourseDetailScreen extends ConsumerStatefulWidget {
  const CourseDetailScreen({super.key, required this.trackId});

  final String trackId;

  @override
  ConsumerState<CourseDetailScreen> createState() => _CourseDetailScreenState();
}

class _CourseDetailScreenState extends ConsumerState<CourseDetailScreen> {
  bool _isStarting = false;

  /// RN `handleItemPress`: every unlocked item opens the player, which
  /// shows `UnsupportedItemCard` for a type this build can't play.
  void _openItem(TrackDetailItem item) {
    context.push(
      '/courses/item/${item.id}',
      extra: (trackId: widget.trackId, item: item),
    );
  }

  Future<void> _startOrContinue(TrackDetail detail) async {
    setState(() => _isStarting = true);
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
    } catch (_) {
      // Swallowed, as RN does — the learner stays on the overview and can
      // retry.
    } finally {
      if (mounted) setState(() => _isStarting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final detailAsync = ref.watch(trackDetailProvider(widget.trackId));

    return Scaffold(
      backgroundColor: Colors.white,
      body: Column(
        children: [
          // RN's CourseOverviewScreen header is always the static "Course"
          // label (`learn.choose.course`) with no credits — the track's own
          // title renders in the body below.
          LearningPathHeader(title: ref.t('learn.choose.course')),
          Expanded(
            child: detailAsync.when(
              loading: () => const LearningPathLoading(),
              // 403 = the course exists but isn't assigned to this learner's
              // org/group (typically a shared link): say so, as RN does.
              error: (error, _) =>
                  error is DioException && error.response?.statusCode == 403
                  ? LearningPathLoadError(
                      title: ref.t('courses.notAvailable.title'),
                      description: ref.t('courses.notAvailable.body'),
                    )
                  : LearningPathLoadError(title: ref.t('courses.notFound')),
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

    // styles.languageRowText / languageRowAction: ROBOTO.REGULAR body.small.
    const textStyle = TextStyle(
      fontFamily: AppFonts.robotoRegular,
      fontSize: 12,
      height: 16 / 12,
      letterSpacing: 0.2,
      color: AppColors.mediumEmphasis,
    );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Text(
              ref.t('courses.language.readingIn', {'language': label}),
              style: textStyle,
            ),
          ),
          GestureDetector(
            key: const Key('course-language-change'),
            behavior: HitTestBehavior.opaque,
            onTap: () => CourseLanguageSheet.show(
              context,
              trackId: detail.id,
              options: options,
              currentLanguageCode: detail.languageCode ?? 'en',
            ),
            child: Text(
              ref.t('courses.language.change'),
              style: textStyle.copyWith(color: AppColors.primary),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBody(BuildContext context, TrackDetail detail) {
    final isCompleted =
        detail.completedAt != null ||
        (detail.totalItems > 0 && detail.completedItems >= detail.totalItems);
    final languageRow = _buildLanguageRow(detail);
    final sections = [...detail.sections]..sort((a, b) => a.order.compareTo(b.order));
    final nextItemId = findNextTrackItemId(sections);

    final leading = <Widget>[
      ?languageRow,
      LearningPathListHeader(
        title: detail.title,
        description: detail.description,
        coverImageUrl: detail.coverImageUrl,
        completed: detail.completedItems,
        total: detail.totalItems,
        isCompleted: isCompleted,
        startButtonLabel: (!detail.enrolled || detail.completedItems == 0)
            ? ref.t('common.start')
            : ref.t('common.continue'),
        onStart: () => _startOrContinue(detail),
        isStartDisabled: _isStarting,
        isLoading: _isStarting,
        // RN: `CourseProgressSheet` (70% bottom sheet), not a screen.
        onProgressTap: detail.enrolled
            ? () => showCourseProgressSheet(
                context,
                trackId: widget.trackId,
                onSessionPress: (session) => openCourseProgressSession(context, session),
                onContinuePress: () => _startOrContinue(detail),
              )
            : null,
      ),
    ];

    return RefreshIndicator(
      onRefresh: () => ref.refresh(trackDetailProvider(widget.trackId).future),
      // Builder: section blocks (each sorting and rendering its item rows)
      // are only built as they scroll in; the language row and header lead.
      child: ListView.builder(
        physics: const AlwaysScrollableScrollPhysics(),
        // styles.scrollContent + ListHeaderComponentStyle paddingTop 4.
        padding: const EdgeInsets.only(left: 21, right: 21, top: 4, bottom: 32),
        itemCount: leading.length + sections.length,
        itemBuilder: (context, index) {
          if (index < leading.length) return leading[index];
          final i = index - leading.length;
          return _CourseSectionBlock(
            section: sections[i],
            sectionIndex: i,
            nextItemId: nextItemId,
            onItemTap: _openItem,
          );
        },
      ),
    );
  }
}

/// RN's `utils/trackNavigation.ts` `findNextItemId`: the first in-progress
/// item (UNLOCKED and started) in section/item order, else the first
/// UNLOCKED one.
String? findNextTrackItemId(List<TrackSection> sortedSections) {
  List<TrackDetailItem> sorted(TrackSection s) =>
      [...s.items]..sort((a, b) => a.order.compareTo(b.order));
  for (final section in sortedSections) {
    for (final item in sorted(section)) {
      if (item.status == TrackItemStatus.unlocked && item.startedAt != null) return item.id;
    }
  }
  for (final section in sortedSections) {
    for (final item in sorted(section)) {
      if (item.status == TrackItemStatus.unlocked) return item.id;
    }
  }
  return null;
}

/// RN's `CourseOverviewScreen/components/CourseSectionBlock.tsx`: a 44px
/// progress ring with the section number, title + subtitle (plain-text
/// description, else "x of y"), then the item rows 8 apart.
class _CourseSectionBlock extends ConsumerWidget {
  const _CourseSectionBlock({
    required this.section,
    required this.sectionIndex,
    required this.nextItemId,
    required this.onItemTap,
  });

  final TrackSection section;
  final int sectionIndex;
  final String? nextItemId;
  final ValueChanged<TrackDetailItem> onItemTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final items = [...section.items]..sort((a, b) => a.order.compareTo(b.order));
    final completedCount = items.where((i) => i.status == TrackItemStatus.completed).length;
    final subtitle = htmlToPlainText(section.description);

    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              CircularProgress(
                progress: completedCount,
                max: items.isEmpty ? 1 : items.length,
                size: 44,
                strokeWidth: 3,
                progressColor: AppColors.primary,
                // styles.indexText: IBM_PLEX_SERIF.MEDIUM + body.medium.
                child: Text(
                  '${sectionIndex + 1}',
                  style: const TextStyle(
                    fontFamily: AppFonts.ibmPlexSerifMedium,
                    fontSize: 14,
                    height: 22 / 14,
                    letterSpacing: 0.2,
                    fontWeight: FontWeight.w500,
                    color: AppColors.highEmphasis,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // styles.sectionTitle: IBM_PLEX_SERIF.MEDIUM + body.large.
                    Text(
                      section.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontFamily: AppFonts.ibmPlexSerifMedium,
                        fontSize: 16,
                        height: 24 / 16,
                        letterSpacing: 0.5,
                        fontWeight: FontWeight.w500,
                        color: AppColors.highEmphasis,
                      ),
                    ),
                    const SizedBox(height: 2),
                    // styles.sectionSubtitle: ROBOTO.REGULAR + body.small.
                    Text(
                      subtitle.isNotEmpty
                          ? subtitle
                          : ref.t('courses.progress', {
                              'completed': completedCount,
                              'total': items.length,
                            }),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: _robotoSmall,
                    ),
                  ],
                ),
              ),
            ],
          ),
          for (var i = 0; i < items.length; i++) ...[
            SizedBox(height: i == 0 ? 10 : 8),
            _CourseItemRow(
              item: items[i],
              isNext: items[i].id == nextItemId,
              onTap: () => onItemTap(items[i]),
            ),
          ],
        ],
      ),
    );
  }
}

const _robotoSmall = TextStyle(
  fontFamily: AppFonts.robotoRegular,
  fontSize: 12,
  height: 16 / 12,
  letterSpacing: 0.2,
  color: AppColors.mediumEmphasis,
);

const _robotoTiny = TextStyle(
  fontFamily: AppFonts.robotoRegular,
  fontSize: 10,
  height: 14 / 10,
  letterSpacing: 0.3,
  color: AppColors.mediumEmphasis,
);

/// RN's `CourseItemRow` TYPE_BADGE_LABEL.
String _typeBadge(TrackItemType type) => switch (type) {
  TrackItemType.roleplay => 'R',
  TrackItemType.caseItem => 'C',
  TrackItemType.quiz => 'Q',
  TrackItemType.article => 'A',
  TrackItemType.video => 'V',
  TrackItemType.journal => 'J',
  TrackItemType.game => 'G',
  TrackItemType.branchingScenario => 'B',
  TrackItemType.bucketSort => 'S',
  TrackItemType.unknown => '',
};

/// RN's `utils/trackItemMeta.ts` `getTrackItemMeta` — the type-specific
/// meta line under each item's title.
String trackItemMeta(TrackDetailItem item, String Function(String, [Map<String, Object?>?]) t) {
  final meta = item.contentMeta;
  final criteria = item.completionCriteria;
  String plural(String key, int count, Map<String, Object?> params) =>
      t('${key}_${count == 1 ? 'one' : 'other'}', params);
  String fmt(num n) => n == n.roundToDouble() ? n.toInt().toString() : n.toString();

  switch (item.type) {
    case TrackItemType.quiz:
      final parts = <String>[];
      final count = meta?.questionCount;
      if (count != null && count > 0) {
        parts.add(plural('courses.meta.questions', count, {'count': count}));
      }
      // A quiz passScore of 0 is a real threshold, so it isn't dropped.
      final passScore = meta?.passScore ?? criteria?.passScore;
      if (passScore != null) parts.add(t('courses.meta.passScore', {'score': fmt(passScore)}));
      return parts.isNotEmpty ? parts.join(' · ') : t('courses.meta.quiz');
    case TrackItemType.video:
      final seconds = meta?.durationSeconds;
      if (seconds != null && seconds > 0) {
        final minutes = (seconds / 60).round().clamp(1, 1 << 30);
        return plural('courses.meta.videoDuration', minutes, {'count': minutes, 'minutes': minutes});
      }
      return t('courses.meta.video');
    case TrackItemType.journal:
      final prompts = meta?.promptCount;
      if (prompts != null && prompts > 0) {
        return plural('courses.meta.prompts', prompts, {'count': prompts});
      }
      return t('courses.meta.journal');
    case TrackItemType.article:
      return t('courses.meta.article');
    case TrackItemType.roleplay:
      // A minScore of 0 is the unconfigured default and gates nothing.
      final minScore = criteria?.minScore ?? 0;
      if (minScore > 0) {
        return '${t('courses.meta.roleplay')} · ${t('courses.meta.minScore', {'score': fmt(minScore)})}';
      }
      return t('courses.meta.roleplay');
    case TrackItemType.caseItem:
      return t('courses.meta.case');
    case TrackItemType.game:
      return t('courses.meta.game');
    case TrackItemType.branchingScenario:
      return t('courses.meta.branchingScenario');
    case TrackItemType.bucketSort:
      return t('courses.meta.bucketSort');
    case TrackItemType.unknown:
      return '';
  }
}

/// RN's `CourseOverviewScreen/components/CourseItemRow.tsx`: a bordered row
/// (primary 1.5px border when it's the current item, greyed when locked)
/// with a 40px type-letter badge (filled when completed, lock when locked),
/// title + tick / status chip, the meta line, and optional captions.
class _CourseItemRow extends ConsumerWidget {
  const _CourseItemRow({required this.item, required this.isNext, required this.onTap});

  final TrackDetailItem item;
  final bool isNext;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isLocked = item.status == TrackItemStatus.locked;
    final isCompleted = item.status == TrackItemStatus.completed;
    final isInProgress = item.status == TrackItemStatus.unlocked && item.startedAt != null;
    final isCurrent = isNext || isInProgress;
    final statusLabel = isCompleted
        ? ref.t('courses.status.completed')
        : isInProgress
        ? ref.t('courses.status.inProgress')
        : isNext
        ? ref.t('common.next')
        : null;

    final row = Material(
      color: isLocked ? AppColors.grey50 : Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: !isLocked && isCurrent
            ? const BorderSide(color: AppColors.primary, width: 1.5)
            : const BorderSide(color: AppColors.strokePrimary),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        key: ValueKey('course-item-${item.id}'),
        onTap: isLocked ? null : onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: isLocked
                      ? AppColors.grey100
                      : isCompleted
                      ? AppColors.primary
                      : null,
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
                    // styles.badgeText: IBM_PLEX_SERIF.MEDIUM + body.medium.
                    : Text(
                        _typeBadge(item.type),
                        style: TextStyle(
                          fontFamily: AppFonts.ibmPlexSerifMedium,
                          fontSize: 14,
                          height: 22 / 14,
                          letterSpacing: 0.2,
                          fontWeight: FontWeight.w500,
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
                      children: [
                        // styles.title: IBM_PLEX_SERIF.REGULAR + body.medium.
                        Expanded(
                          child: Text(
                            item.title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontFamily: AppFonts.ibmPlexSerifRegular,
                              fontSize: 14,
                              height: 22 / 14,
                              letterSpacing: 0.2,
                              color: AppColors.highEmphasis,
                            ),
                          ),
                        ),
                        if (isCompleted) ...[
                          const SizedBox(width: 8),
                          SvgPicture.asset(
                            'assets/icons/tickRound.svg',
                            key: const ValueKey('item-completed-tick'),
                            width: 16,
                            height: 16,
                          ),
                        ],
                        if (!isCompleted && statusLabel != null) ...[
                          const SizedBox(width: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: AppColors.lightBlue50,
                              borderRadius: BorderRadius.circular(16),
                            ),
                            child: Text(
                              statusLabel,
                              style: _robotoTiny.copyWith(color: AppColors.primary),
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(trackItemMeta(item, ref.t), style: _robotoSmall),
                    if (item.languageFallbackReason != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        ref.t('courses.language.fallback.${item.languageFallbackReason}'),
                        style: _robotoTiny,
                      ),
                    ],
                    if (isLocked) ...[
                      const SizedBox(height: 2),
                      Text(
                        ref.t('courses.lockedTooltip'),
                        style: _robotoTiny.copyWith(color: AppColors.lowEmphasis),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );

    // styles.rowLocked: opacity 0.7.
    return isLocked ? Opacity(opacity: 0.7, child: row) : row;
  }
}
