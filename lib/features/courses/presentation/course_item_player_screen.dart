import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/rn_scale.dart';
import '../../../core/widgets/html_rich_text.dart';
import '../data/course_models.dart';
import '../data/courses_repository.dart';
import '../data/start_item_payload.dart';
import 'article/article_player.dart';
import 'branching/branching_scenario_player.dart';
import 'bucket_sort/bucket_sort_player.dart';
import 'celebration_modal.dart';
import 'course_button.dart';
import 'course_styles.dart';
import 'discussion/discussion_thread.dart';
import 'game/game_player.dart';
import 'journal/journal_player.dart';
import 'quiz/quiz_player.dart';
import 'roleplay/roleplay_case_player.dart';
import 'video/video_item_player.dart';
import '../../../core/navigation/home_tab_navigation.dart';
import '../../../core/navigation/tab_config.dart';

/// Port of RN `screens/CourseItemPlayerScreen/CourseItemPlayerScreen.tsx`:
/// a single screen that walks the whole track (RN's
/// `useTrackPlayerNavigation` — Prev/Next swap the current item in place
/// and re-POST `startTrackItem`), with RN's chrome: [_PlayerTopBar] (exit,
/// section eyebrow, item title, description, overall %, the section's
/// [_SegmentedProgressRail]), the item body, the item's
/// [DiscussionThread] when `hasDiscussion`, [_PlayerBottomNav] and the
/// [CelebrationModal]. Track and item load failures show RN's message and
/// Retry; an item type with no player shows [_UnsupportedItemCard].
///
/// Next is gated on the current item being completed (server status or
/// completed in this session). ROLEPLAY/CASE and the breathing exercise
/// complete out of band, so returning to this screen after launching one
/// refetches the track (RN `getActiveTrackContext`).
class CourseItemPlayerScreen extends ConsumerStatefulWidget {
  const CourseItemPlayerScreen({
    super.key,
    required this.trackId,
    this.item,
    String? itemId,
    this.highlightPostId,
  }) : assert(item != null || itemId != null),
       itemId = itemId ?? '';

  final String trackId;

  /// The item opened from the overview; null when opened by id alone (a
  /// discussion-reply notification).
  final TrackDetailItem? item;
  final String itemId;

  /// RN `highlightPostId`: the discussion post a reply notification points at.
  final String? highlightPostId;

  String get initialItemId => item?.id ?? itemId;

  @override
  ConsumerState<CourseItemPlayerScreen> createState() =>
      _CourseItemPlayerScreenState();
}

/// Route `extra` for `/courses/item/:itemId` when there is no
/// [TrackDetailItem] to hand over (RN params `{trackId, itemId,
/// highlightPostId}`).
class CourseItemPlayerArgs {
  const CourseItemPlayerArgs({required this.trackId, this.item, this.highlightPostId});

  final String trackId;
  final TrackDetailItem? item;
  final String? highlightPostId;
}

/// One entry of RN's `flattenTrackItems()` — a track's sections/items
/// (both sorted by `order`) walked into one ordered list.
class _FlatTrackItem {
  const _FlatTrackItem({
    required this.item,
    required this.sectionId,
    required this.sectionTitle,
  });

  final TrackDetailItem item;
  final String sectionId;
  final String sectionTitle;
}

List<_FlatTrackItem> _flattenTrackItems(TrackDetail detail) {
  final sections = [...detail.sections]..sort((a, b) => a.order.compareTo(b.order));
  return [
    for (final section in sections)
      for (final item in [...section.items]..sort((a, b) => a.order.compareTo(b.order)))
        _FlatTrackItem(item: item, sectionId: section.id, sectionTitle: section.title),
  ];
}

/// RN `ActivityIndicator size="large" color={primary}`.
Widget _largeSpinner(BuildContext context) => CupertinoActivityIndicator(
  key: const Key('player-loading'),
  radius: RnSize.of(context).raw(18),
  color: AppColors.primary,
);

class _CourseItemPlayerScreenState
    extends ConsumerState<CourseItemPlayerScreen> {
  StartItemPayload? _payload;
  bool _isLoadingItem = true;
  bool _loadError = false;
  CelebrationKind? _celebration;
  late String _currentItemId = widget.initialItemId;

  /// RN `justCompleted`: items completed in this player session.
  final Set<String> _justCompleted = {};

  /// Set when a roleplay/case/breathing exercise was launched from here —
  /// RN's stashed `ActiveTrackContext`. Consumed on the next return.
  bool _refetchTrackOnReturn = false;
  bool _wasCurrent = true;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final isCurrent = ModalRoute.of(context)?.isCurrent ?? true;
    if (isCurrent && !_wasCurrent && _refetchTrackOnReturn) {
      _refetchTrackOnReturn = false;
      // Not during build: invalidating notifies the provider scope.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) ref.invalidate(trackDetailProvider(widget.trackId));
      });
    }
    _wasCurrent = isCurrent;
  }

  @override
  void initState() {
    super.initState();
    _loadItem();
  }

  /// RN `loadItem`.
  Future<void> _loadItem() async {
    final itemId = _currentItemId;
    setState(() {
      _isLoadingItem = true;
      _loadError = false;
      _payload = null;
    });
    try {
      final payload = await ref.read(coursesRepositoryProvider).startTrackItem(itemId);
      if (!mounted || itemId != _currentItemId) return;
      setState(() {
        _payload = payload;
        _isLoadingItem = false;
      });
    } catch (_) {
      if (!mounted || itemId != _currentItemId) return;
      setState(() {
        _loadError = true;
        _isLoadingItem = false;
      });
    }
  }

  /// RN `handleCompletion` — a track-complete celebration wins over a
  /// section-complete one.
  void _handleCompletion(TrackItemCompletionResult result) {
    if (!result.completed) return;
    setState(() {
      _justCompleted.add(_currentItemId);
      if (result.trackCompleted) {
        _celebration = CelebrationKind.track;
      } else if (result.sectionCompleted) {
        _celebration = CelebrationKind.section;
      }
    });
  }

  bool _isItemCompleted(TrackDetailItem item) =>
      item.status == TrackItemStatus.completed || _justCompleted.contains(item.id);

  void _goToItem(String itemId) {
    setState(() => _currentItemId = itemId);
    _loadItem();
  }

  List<_FlatTrackItem>? _flat() {
    final detail = ref.read(trackDetailProvider(widget.trackId)).value;
    return detail == null ? null : _flattenTrackItems(detail);
  }

  /// RN `goNextOrOverview`.
  void _goNextOrOverview() {
    final flat = _flat();
    final currentIndex = flat?.indexWhere((f) => f.item.id == _currentItemId) ?? -1;
    if (flat != null && currentIndex != -1 && currentIndex < flat.length - 1) {
      _goToItem(flat[currentIndex + 1].item.id);
    } else {
      _exitToOverview();
    }
  }

  /// RN `handleBackToOverview`.
  void _exitToOverview() {
    if (context.canPop()) {
      context.pop();
    } else {
      context.go('/courses/${widget.trackId}');
    }
  }

  @override
  Widget build(BuildContext context) {
    final trackAsync = ref.watch(trackDetailProvider(widget.trackId));
    final detail = trackAsync.value;
    final flat = detail == null ? const <_FlatTrackItem>[] : _flattenTrackItems(detail);
    final currentIndex = flat.indexWhere((f) => f.item.id == _currentItemId);
    final current = currentIndex == -1 ? null : flat[currentIndex];
    final hasPrev = currentIndex > 0;
    final hasNext = currentIndex != -1 && currentIndex < flat.length - 1;
    final canAdvance = current != null && _isItemCompleted(current.item);
    final sectionItems = current == null
        ? const <_FlatTrackItem>[]
        : flat.where((f) => f.sectionId == current.sectionId).toList();
    // RN computeOverallPct: server COMPLETED status only.
    final overallPct = flat.isEmpty
        ? 0
        : (flat.where((f) => f.item.status == TrackItemStatus.completed).length / flat.length * 100).round();
    final completedCount = flat.where((f) => _isItemCompleted(f.item)).length;
    final isTrackLoadPending = trackAsync.isLoading && detail == null;
    final isTrackError = trackAsync.hasError && detail == null;

    return Scaffold(
      backgroundColor: Colors.white,
      body: Stack(
        children: [
          SafeArea(
            child: Column(
              children: [
                _PlayerTopBar(
                  sectionTitle: current?.sectionTitle ?? '',
                  itemTitle: current?.item.title ?? '',
                  description: current?.item.description,
                  sectionItems: sectionItems,
                  currentItemId: _currentItemId,
                  overallPct: overallPct,
                  onExit: _exitToOverview,
                ),
                Expanded(
                  child: _buildBody(
                    isTrackError: isTrackError,
                    isTrackLoadPending: isTrackLoadPending,
                    current: current,
                  ),
                ),
                if (current?.item.hasDiscussion ?? false)
                  DiscussionThread(
                    key: ValueKey('discussion-$_currentItemId'),
                    itemId: _currentItemId,
                    highlightPostId: widget.highlightPostId,
                  ),
                _PlayerBottomNav(
                  hasPrev: hasPrev,
                  isLastItem: !hasNext,
                  canAdvance: canAdvance,
                  onPrev: () {
                    if (hasPrev) _goToItem(flat[currentIndex - 1].item.id);
                  },
                  onNext: _goNextOrOverview,
                ),
              ],
            ),
          ),
          if (_celebration != null)
            Positioned.fill(
              child: CelebrationModal(
                kind: _celebration!,
                completedCount: completedCount,
                onContinue: () {
                  setState(() => _celebration = null);
                  _goNextOrOverview();
                },
                onBackToLearn: () {
                  setState(() => _celebration = null);
                  goToHomeTab(GoRouter.of(context), kTabLearn);
                },
              ),
            ),
        ],
      ),
    );
  }

  Widget _centered(List<Widget> children) => Center(
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: withGap(children, () => const SizedBox(height: 12)),
      ),
    ),
  );

  Widget _buildBody({
    required bool isTrackError,
    required bool isTrackLoadPending,
    required _FlatTrackItem? current,
  }) {
    final errorStyle = CourseText.system(const TextStyle(fontSize: 14), AppColors.mediumEmphasis);
    if (isTrackError && !isTrackLoadPending) {
      return _centered([
        Text(ref.t('courses.player.trackLoadFailed'), textAlign: TextAlign.center, style: errorStyle),
        CourseButton(
          key: const Key('player-track-retry'),
          label: ref.t('courses.player.retry'),
          onPressed: () => ref.invalidate(trackDetailProvider(widget.trackId)),
        ),
      ]);
    }
    if (_loadError) {
      return _centered([
        Text(ref.t('courses.player.loadFailed'), textAlign: TextAlign.center, style: errorStyle),
        CourseButton(key: const Key('player-item-retry'), label: ref.t('courses.player.retry'), onPressed: _loadItem),
      ]);
    }
    // RN also waits for `nav.current`; an item missing from the track would
    // spin forever there, so the item handed in by the route stands in.
    final item = current?.item ?? (widget.item?.id == _currentItemId ? widget.item : null);
    if (isTrackLoadPending || _isLoadingItem || _payload == null || item == null) {
      return Center(child: _largeSpinner(context));
    }

    final payload = _payload!;
    // Keyed by item so Prev/Next between two items of the same type never
    // reuses the previous item's local state.
    final key = ValueKey(_currentItemId);
    // RN `alreadyCompleted`: server COMPLETED status OR completed here.
    final alreadyCompleted = _isItemCompleted(item);
    switch (payload.type) {
      case 'ARTICLE':
        return ArticlePlayer(
          key: key,
          payload: payload,
          itemId: _currentItemId,
          alreadyCompleted: alreadyCompleted,
          onCompleted: _handleCompletion,
        );
      case 'VIDEO':
        return VideoItemPlayer(
          key: key,
          payload: payload,
          itemId: _currentItemId,
          alreadyCompleted: alreadyCompleted,
          onCompleted: _handleCompletion,
        );
      case 'JOURNAL':
        return JournalPlayer(
          key: key,
          payload: payload,
          itemId: _currentItemId,
          alreadyCompleted: alreadyCompleted,
          onCompleted: _handleCompletion,
        );
      case 'QUIZ':
        return QuizPlayer(
          key: key,
          itemId: _currentItemId,
          quiz: payload.quiz!,
          attemptsUsed: payload.attemptsUsed ?? 0,
          maxAttempts: payload.maxAttempts,
          onCompleted: _handleCompletion,
          onRequestNext: _goNextOrOverview,
        );
      case 'GAME':
        if (payload.gameKey == 'BREATHING_EXERCISE' && payload.breathingExercise != null) {
          return _BreathingExerciseIntro(
            key: key,
            payload: payload,
            onCompleted: _handleCompletion,
            onLaunched: () => _refetchTrackOnReturn = true,
          );
        }
        if (payload.gameKey == 'BREATHING_EXERCISE') {
          return _UnsupportedItemCard(onBackToCourse: _exitToOverview);
        }
        return GamePlayer(
          key: key,
          payload: payload,
          itemId: _currentItemId,
          onCompleted: _handleCompletion,
        );
      case 'BRANCHING_SCENARIO':
        return BranchingScenarioPlayer(
          key: key,
          payload: payload,
          itemId: _currentItemId,
          onCompleted: _handleCompletion,
          onRequestNext: _goNextOrOverview,
          onBack: _exitToOverview,
        );
      case 'BUCKET_SORT':
        return BucketSortPlayer(
          key: key,
          payload: payload,
          itemId: _currentItemId,
          onCompleted: _handleCompletion,
          onRequestNext: _goNextOrOverview,
        );
      case 'ROLEPLAY':
      case 'CASE':
        return RoleplayCasePlayer(
          key: key,
          payload: payload,
          item: item,
          alreadyCompleted: alreadyCompleted,
          onLaunched: () => _refetchTrackOnReturn = true,
        );
      default:
        return _UnsupportedItemCard(onBackToCourse: _exitToOverview);
    }
  }
}

/// Port of RN `components/UnsupportedItemCard.tsx`: an item type this build
/// has no player for. Doesn't force Next open.
class _UnsupportedItemCard extends ConsumerWidget {
  const _UnsupportedItemCard({required this.onBackToCourse});

  final VoidCallback onBackToCourse;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Center(
      key: const Key('unsupported-item-card'),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              ref.t('courses.player.unsupportedTitle'),
              textAlign: TextAlign.center,
              style: CourseText.serif(CourseType.bodyLarge, AppColors.highEmphasis, weight: FontWeight.w500),
            ),
            const SizedBox(height: 12),
            Text(
              ref.t('courses.player.unsupportedBody'),
              textAlign: TextAlign.center,
              style: CourseText.serif(CourseType.bodyMedium, AppColors.mediumEmphasis),
            ),
            const SizedBox(height: 12),
            CourseButton(
              key: const Key('unsupported-back-to-course'),
              label: ref.t('courses.player.backToCourse'),
              variant: CourseButtonVariant.secondary,
              onPressed: onBackToCourse,
            ),
          ],
        ),
      ),
    );
  }
}

/// Port of RN `components/players/NativeGamePlayer.tsx` for the
/// `BREATHING_EXERCISE` game key: title, intro and Start, which opens the
/// full-screen `BreathingExerciseScreen`. The item is complete server-side
/// when opened, so completion is reported on mount.
class _BreathingExerciseIntro extends ConsumerStatefulWidget {
  const _BreathingExerciseIntro({
    super.key,
    required this.payload,
    required this.onCompleted,
    required this.onLaunched,
  });

  final StartItemPayload payload;
  final void Function(TrackItemCompletionResult result) onCompleted;

  /// RN `setActiveTrackContext`: refetch the track on return.
  final VoidCallback onLaunched;

  @override
  ConsumerState<_BreathingExerciseIntro> createState() => _BreathingExerciseIntroState();
}

class _BreathingExerciseIntroState extends ConsumerState<_BreathingExerciseIntro> {
  @override
  void initState() {
    super.initState();
    // Post-frame: the parent's setState can't run during this build.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        widget.onCompleted(
          widget.payload.gameCompletion ??
              TrackItemCompletionResult(completed: true, sectionCompleted: false, trackCompleted: false),
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final config = widget.payload.breathingExercise!;
    final intro = widget.payload.gameIntro;
    // styles.container: centred, padding 24, gap 24; content gap 8.
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              ref.t('courses.breathing.title'),
              textAlign: TextAlign.center,
              // typography.display.small + IBM Plex Serif Medium.
              style: const TextStyle(
                fontFamily: AppFonts.ibmPlexSerifMedium,
                fontSize: 18,
                height: 24 / 18,
                letterSpacing: 0.18,
                color: AppColors.highEmphasis,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              (intro ?? '').isNotEmpty ? intro! : ref.t('courses.breathing.defaultIntro'),
              textAlign: TextAlign.center,
              style: CourseText.serif(CourseType.bodyMedium, AppColors.mediumEmphasis),
            ),
            const SizedBox(height: 24),
            CourseButton(
              label: ref.t('courses.breathing.start'),
              onPressed: () {
                widget.onLaunched();
                context.push('/breathing-exercise', extra: config);
              },
            ),
          ],
        ),
      ),
    );
  }
}

/// Port of RN `components/PlayerTopBar.tsx`.
class _PlayerTopBar extends ConsumerWidget {
  const _PlayerTopBar({
    required this.sectionTitle,
    required this.itemTitle,
    required this.description,
    required this.sectionItems,
    required this.currentItemId,
    required this.overallPct,
    required this.onExit,
  });

  final String sectionTitle;
  final String itemTitle;
  final String? description;
  final List<_FlatTrackItem> sectionItems;
  final String currentItemId;
  final int overallPct;
  final VoidCallback onExit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final size = RnSize.of(context);
    final tiny = CourseText.roboto(CourseType.bodyTiny, AppColors.mediumEmphasis);
    final plainDescription = htmlToPlainText(description);
    // styles.header: padding 16/12/10, borderBottom 0.5, gap 8.
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 10),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(bottom: BorderSide(color: AppColors.strokePrimary, width: 0.5)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: withGap<Widget>([
          Row(
            children: [
              Semantics(
                button: true,
                label: ref.t('courses.player.exit'),
                child: GestureDetector(
                  key: const Key('player-exit-button'),
                  behavior: HitTestBehavior.opaque,
                  onTap: onExit,
                  child: SizedBox(
                    width: 32,
                    height: 32,
                    child: Center(
                      child: SvgPicture.asset('assets/icons/close.svg', width: size.raw(16), height: size.raw(16)),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(sectionTitle, maxLines: 1, overflow: TextOverflow.ellipsis, style: tiny),
                    Text(
                      itemTitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: CourseText.serifMedium(CourseType.bodyMedium, AppColors.highEmphasis, weight: FontWeight.w500),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              Text(ref.t('courses.player.overallProgress', {'pct': overallPct}), style: tiny),
            ],
          ),
          if (plainDescription.isNotEmpty)
            Text(
              plainDescription,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: CourseText.roboto(CourseType.bodySmall, AppColors.mediumEmphasis),
            ),
          _SegmentedProgressRail(sectionItems: sectionItems, currentItemId: currentItemId),
        ], () => const SizedBox(height: 8)),
      ),
    );
  }
}

/// Port of RN `components/SegmentedProgressRail.tsx`: one segment per item
/// of the current section — completed (server status) fills primary, the
/// current item is lightBlue[200], the rest grey[200]. Gap 4, height 4,
/// radius 2.
class _SegmentedProgressRail extends StatelessWidget {
  const _SegmentedProgressRail({required this.sectionItems, required this.currentItemId});

  final List<_FlatTrackItem> sectionItems;
  final String currentItemId;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: withGap<Widget>([
        for (final flatItem in sectionItems)
          Expanded(
            child: Container(
              key: ValueKey('progress-segment-${flatItem.item.id}'),
              height: 4,
              decoration: BoxDecoration(
                color: flatItem.item.status == TrackItemStatus.completed
                    ? AppColors.primary
                    : flatItem.item.id == currentItemId
                    ? AppColors.lightBlue200
                    : AppColors.grey200,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
      ], () => const SizedBox(width: 4)),
    );
  }
}

/// Port of RN `components/PlayerBottomNav.tsx`: Prev (secondary, left
/// arrow) and Next/Finish (primary, right arrow), Next disabled until the
/// item reports completion.
class _PlayerBottomNav extends ConsumerWidget {
  const _PlayerBottomNav({
    required this.hasPrev,
    required this.isLastItem,
    required this.canAdvance,
    required this.onPrev,
    required this.onNext,
  });

  final bool hasPrev;
  final bool isLastItem;
  final bool canAdvance;
  final VoidCallback onPrev;
  final VoidCallback onNext;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final icon = RnSize.of(context).raw(16);
    // styles.footer: row, gap 12, padding 16/12, borderTop 0.5.
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: AppColors.strokePrimary, width: 0.5)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: CourseButton(
              key: const Key('player-prev-button'),
              label: ref.t('courses.player.prev'),
              variant: CourseButtonVariant.secondary,
              isDisabled: !hasPrev,
              onPressed: onPrev,
              iconLeft: SvgPicture.asset('assets/icons/leftArrowIcon.svg', width: icon, height: icon),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: CourseButton(
              key: const Key('player-next-button'),
              label: ref.t(isLastItem ? 'courses.player.finish' : 'courses.player.next'),
              isDisabled: !canAdvance,
              onPressed: onNext,
              iconRight: SvgPicture.asset('assets/icons/arrowRight.svg', width: icon, height: icon),
            ),
          ),
        ],
      ),
    );
  }
}
