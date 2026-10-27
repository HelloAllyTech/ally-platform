// RadioListTile's onChanged/groupValue are deprecated in favor of a
// RadioGroup ancestor widget (Flutter 3.32+) — migrating every radio group
// in this screen to that API is a separate refactor, not done here; the
// deprecated API still works correctly.
// ignore_for_file: deprecated_member_use

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/html_rich_text.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../data/course_models.dart';
import '../data/courses_repository.dart';
import '../data/start_item_payload.dart';
import 'branching/branching_scenario_player.dart';
import 'bucket_sort/bucket_sort_player.dart';
import 'celebration_modal.dart';
import 'game/game_player.dart';
import 'journal/journal_player.dart';
import 'quiz/quiz_player.dart';
import 'video/video_item_player.dart';

/// Full port of ally-mobile (React Native)'s `CourseItemPlayerScreen`
/// (~9,700 lines across its real component tree) for ARTICLE, VIDEO, QUIZ,
/// JOURNAL, GAME, BRANCHING_SCENARIO, and BUCKET_SORT item types — real
/// `startTrackItem` content (not a stub), inline article questions, video
/// interjections, the complete 8-question-type quiz engine, debounced
/// journal autosave, the same HTML5 game bundles the RN and web apps embed,
/// a locally-walked branching-scenario story graph, and a tap-to-place
/// bucket-sort game. ROLEPLAY/CASE route elsewhere via the existing
/// Simulations/Cases screens, same as the RN app.
///
/// In-player Prev/Next navigation and the per-section progress rail (RN's
/// `useTrackPlayerNavigation` + `PlayerTopBar`/`SegmentedProgressRail`/
/// `PlayerBottomNav`) are ported here too: `trackId` lets this screen watch
/// the already-fetched `trackDetailProvider` and flatten its
/// sections/items into one ordered list, same as RN's `flattenTrackItems`.
/// Confirmed directly from the real source that this is genuinely a
/// same-screen-instance, re-fetch-in-place design — RN's own Prev/Next
/// never pushes a new screen, it just swaps `currentItemId` local state and
/// re-POSTs `startTrackItem` for the new id, matched exactly here by
/// `_goToItem`. "Next" is gated on the *current* item reporting completion
/// (server status OR an in-session `_justCompleted` set, so a freshly
/// completed item doesn't need a track refetch to unlock forward
/// navigation) — never on a server "what's next" call; RN's real
/// `next-item` endpoint (`CoursesRepository.getNextTrackItem`) only powers
/// the Start/Continue entry points elsewhere (`CourseDetailScreen`'s
/// Start/Continue button, `CourseProgressScreen`'s Continue/PracticeNudge
/// actions), confirmed by checking every real caller of that endpoint.
///
/// If `trackDetailProvider` hasn't resolved yet (or errors — e.g. in tests
/// that don't stub `getLearnTrackDetail`), the nav chrome simply doesn't
/// render and this falls back to the old single-item `TabScreenHeader`
/// shell, rather than blocking the item itself on a second network call.
///
/// Not ported from the same RN feature area (separate, larger follow-up):
/// the in-player discussion thread (`hasDiscussion`-gated, its own
/// CRUD+moderation system, unrelated to the Review screens' comments).
class CourseItemPlayerScreen extends ConsumerStatefulWidget {
  const CourseItemPlayerScreen({super.key, required this.trackId, required this.item});

  final String trackId;
  final TrackDetailItem item;

  @override
  ConsumerState<CourseItemPlayerScreen> createState() =>
      _CourseItemPlayerScreenState();
}

/// One entry of RN's `flattenTrackItems()` — a track's sections/items
/// (both sorted by `order`) walked into one ordered list, each entry
/// carrying enough of its section to drive the per-section progress rail.
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

class _CourseItemPlayerScreenState
    extends ConsumerState<CourseItemPlayerScreen> {
  StartItemPayload? _payload;
  bool _isLoading = true;
  String? _error;
  bool _completed = false;
  CelebrationKind? _celebration;
  late String _currentItemId = widget.item.id;

  /// Items whose completion was just reported in this session but may not
  /// be reflected in `trackDetailProvider`'s cached `TrackDetail` yet (a
  /// full track refetch isn't triggered per-item) — unioned with the
  /// server's own `TrackItemStatus.completed` wherever "is this item done"
  /// is asked, same as RN's `justCompletedItemIds` set.
  final Set<String> _justCompleted = {};

  @override
  void initState() {
    super.initState();
    _start();
  }

  Future<void> _start() async {
    setState(() {
      _isLoading = true;
      _error = null;
      _payload = null;
      _completed = false;
      _celebration = null;
    });
    try {
      final payload = await ref
          .read(coursesRepositoryProvider)
          .startTrackItem(_currentItemId);
      if (!mounted) return;
      setState(() {
        _payload = payload;
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '${ref.tr('courses.player.loadFailed')}: $e';
        _isLoading = false;
      });
    }
  }

  Future<void> _markArticleComplete() async {
    final result = await ref
        .read(coursesRepositoryProvider)
        .markArticleRead(_currentItemId);
    if (mounted) _handleCompletion(result);
  }

  /// Mirrors RN's `handleCompletion` — a track-complete celebration always
  /// wins over a section-complete one (a track can't finish without its
  /// last section finishing too, so showing both would be redundant).
  void _handleCompletion(TrackItemCompletionResult result) {
    if (!result.completed) return;
    setState(() {
      _completed = true;
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
    _start();
  }

  /// Mirrors RN's `goNextOrOverview`: advance to the next item in the
  /// flattened track if there is one, otherwise leave for the overview.
  /// Used by players (branching, bucket sort) whose own "Continue" button
  /// plays the same role as the bottom nav's "Next"/"Finish".
  void _goNextOrOverview() {
    final detail = ref.read(trackDetailProvider(widget.trackId)).value;
    final flat = detail == null ? null : _flattenTrackItems(detail);
    final currentIndex = flat?.indexWhere((f) => f.item.id == _currentItemId) ?? -1;
    if (flat != null && currentIndex != -1 && currentIndex < flat.length - 1) {
      _goToItem(flat[currentIndex + 1].item.id);
    } else {
      _exitToOverview();
    }
  }

  void _exitToOverview() {
    if (context.canPop()) {
      context.pop();
    } else {
      context.go('/courses/${widget.trackId}');
    }
  }

  @override
  Widget build(BuildContext context) {
    final detail = ref.watch(trackDetailProvider(widget.trackId)).value;
    final flat = detail == null ? null : _flattenTrackItems(detail);
    final currentIndex = flat == null ? -1 : flat.indexWhere((f) => f.item.id == _currentItemId);
    final hasNav = flat != null && currentIndex != -1;

    Widget? topBar;
    Widget? bottomNav;
    if (hasNav) {
      final current = flat[currentIndex];
      final sectionItems = flat.where((f) => f.sectionId == current.sectionId).toList();
      final completedCount = flat.where((f) => _isItemCompleted(f.item)).length;
      final overallPct = flat.isEmpty ? 0.0 : completedCount / flat.length * 100;
      final hasPrev = currentIndex > 0;
      final hasNext = currentIndex < flat.length - 1;
      final canAdvance = _isItemCompleted(current.item);

      topBar = _PlayerTopBar(
        sectionTitle: current.sectionTitle,
        itemTitle: current.item.title,
        description: current.item.description,
        sectionItems: sectionItems,
        currentItemId: _currentItemId,
        isCompleted: _isItemCompleted,
        overallPct: overallPct,
        onExit: _exitToOverview,
      );
      bottomNav = _PlayerBottomNav(
        hasPrev: hasPrev,
        isLastItem: !hasNext,
        canAdvance: canAdvance,
        onPrev: hasPrev ? () => _goToItem(flat[currentIndex - 1].item.id) : null,
        onNext: canAdvance
            ? () => hasNext ? _goToItem(flat[currentIndex + 1].item.id) : _exitToOverview()
            : null,
      );
    }

    return Scaffold(
      body: SafeArea(
        child: Stack(
          children: [
            Column(
              children: [
                topBar ?? TabScreenHeader(title: widget.item.title),
                Expanded(
                  child: _isLoading
                      ? const Center(child: CircularProgressIndicator())
                      : _error != null
                      ? Center(
                          child: Text(
                            _error!,
                            style: const TextStyle(color: AppColors.red400),
                          ),
                        )
                      : _buildBody(),
                ),
                ?bottomNav,
              ],
            ),
            if (_celebration != null)
              Positioned.fill(
                child: CelebrationModal(
                  kind: _celebration!,
                  onContinue: () => setState(() => _celebration = null),
                  onBackToLearn: () => context.go('/home'),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildBody() {
    final payload = _payload!;
    // Keyed by the current item id so navigating Prev/Next to another item
    // of the *same* payload type (e.g. ARTICLE -> ARTICLE) still tears down
    // and rebuilds a fresh child, rather than reusing one still holding the
    // previous item's local state (answered questions, scroll position).
    final key = ValueKey(_currentItemId);
    switch (payload.type) {
      case 'QUIZ':
        return QuizPlayer(
          key: key,
          itemId: _currentItemId,
          quiz: payload.quiz!,
          attemptsUsed: payload.attemptsUsed ?? 0,
          maxAttempts: payload.maxAttempts,
          onCompleted: _handleCompletion,
        );
      case 'ARTICLE':
        return _ArticleView(
          key: key,
          payload: payload,
          itemId: _currentItemId,
          completed: _completed,
          onMarkComplete: _markArticleComplete,
        );
      case 'VIDEO':
        return VideoItemPlayer(
          key: key,
          payload: payload,
          itemId: _currentItemId,
          alreadyCompleted: _completed,
          onCompleted: _handleCompletion,
        );
      case 'JOURNAL':
        return JournalPlayer(
          key: key,
          payload: payload,
          itemId: _currentItemId,
          alreadyCompleted: _completed,
          onCompleted: _handleCompletion,
        );
      case 'GAME':
        // RN's `NativeGamePlayer` replaces the usual HTML5 `GamePlayer` for
        // this one game key — it carries a config object instead of
        // loading a bundle.
        if (payload.gameKey == 'BREATHING_EXERCISE' && payload.breathingExercise != null) {
          return _BreathingExerciseIntro(
            key: key,
            payload: payload,
            onCompleted: _handleCompletion,
          );
        }
        return GamePlayer(
          key: key,
          payload: payload,
          itemId: _currentItemId,
          onCompleted: _handleCompletion,
        );
      case 'BRANCHING_SCENARIO':
        return BranchingScenarioPlayer(
          // Two scenarios back to back must not share a run.
          key: key,
          payload: payload,
          itemId: _currentItemId,
          onCompleted: _handleCompletion,
          onRequestNext: _goNextOrOverview,
          onBack: _exitToOverview,
        );
      case 'BUCKET_SORT':
        return BucketSortPlayer(
          // Two sorts back to back must not share a round.
          key: key,
          payload: payload,
          itemId: _currentItemId,
          onCompleted: _handleCompletion,
          onRequestNext: _goNextOrOverview,
        );
      default:
        return Center(child: Text(ref.t('courses.player.unsupportedTitle')));
    }
  }
}

/// Port of ally-mobile (React Native)'s `NativeGamePlayer` for the
/// `BREATHING_EXERCISE` game key — an intro card (title + intro text +
/// Start button) shown inline in the player; tapping Start pushes the
/// full-screen `BreathingExerciseScreen`. The item is already complete
/// server-side the moment this card is shown (same as every other game
/// key — see `GamePlayer`'s own doc comment), so completion is reported
/// on mount regardless of whether the learner ever taps Start.
class _BreathingExerciseIntro extends ConsumerStatefulWidget {
  const _BreathingExerciseIntro({super.key, required this.payload, required this.onCompleted});

  final StartItemPayload payload;
  final void Function(TrackItemCompletionResult result) onCompleted;

  @override
  ConsumerState<_BreathingExerciseIntro> createState() => _BreathingExerciseIntroState();
}

class _BreathingExerciseIntroState extends ConsumerState<_BreathingExerciseIntro> {
  @override
  void initState() {
    super.initState();
    // Deferred to a post-frame callback — calling the parent's setState
    // synchronously here throws "setState() or markNeedsBuild() called
    // during build" (same gotcha GamePlayer's own doc comment documents).
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        widget.onCompleted(
          widget.payload.gameCompletion ??
              TrackItemCompletionResult(
                completed: true,
                sectionCompleted: false,
                trackCompleted: false,
              ),
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final config = widget.payload.breathingExercise!;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              ref.t('courses.breathing.title'),
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 8),
            Text(
              widget.payload.gameIntro?.isNotEmpty ?? false
                  ? widget.payload.gameIntro!
                  : ref.t('courses.breathing.defaultIntro'),
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.mediumEmphasis),
            ),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              child: AppButton(
                label: ref.t('courses.breathing.start'),
                onPressed: () => context.push('/breathing-exercise', extra: config),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ArticleView extends ConsumerStatefulWidget {
  const _ArticleView({
    super.key,
    required this.payload,
    required this.itemId,
    required this.completed,
    required this.onMarkComplete,
  });

  final StartItemPayload payload;
  final String itemId;
  final bool completed;
  final VoidCallback onMarkComplete;

  @override
  ConsumerState<_ArticleView> createState() => _ArticleViewState();
}

class _ArticleViewState extends ConsumerState<_ArticleView> {
  final Map<String, String> _answeredOptionIds = {};
  final Map<
    String,
    ({bool correct, String correctOptionId, String? explanation})
  >
  _results = {};

  Future<void> _answer(ArticleQuestion question, String optionId) async {
    try {
      final result = await ref
          .read(coursesRepositoryProvider)
          .submitArticleQuestionAnswer(
            itemId: widget.itemId,
            questionId: question.id,
            selectedOptionId: optionId,
          );
      setState(() {
        _answeredOptionIds[question.id] = optionId;
        _results[question.id] = result;
      });
    } catch (_) {
      // Swallowed intentionally for this pass — a failed inline-question
      // submission shouldn't block reading the rest of the article.
    }
  }

  @override
  Widget build(BuildContext context) {
    final payload = widget.payload;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        HtmlRichText(html: payload.html),
        const SizedBox(height: 24),
        for (final question in payload.articleQuestions ?? [])
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: AppCard(
              variant: AppCardVariant.flat,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      question.prompt,
                      style: Theme.of(context).textTheme.titleSmall,
                    ),
                    for (final option in question.options)
                      RadioListTile<String>(
                        title: Text(option.text),
                        value: option.id,
                        groupValue: _answeredOptionIds[question.id],
                        onChanged: _answeredOptionIds.containsKey(question.id)
                            ? null
                            : (value) => _answer(question, value!),
                      ),
                    if (_results[question.id] != null)
                      Text(
                        _results[question.id]!.correct
                            ? ref.t('courses.article.question.correct')
                            : ref.t('courses.article.question.incorrect'),
                        style: TextStyle(
                          color: _results[question.id]!.correct
                              ? Colors.green
                              : AppColors.red400,
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        const SizedBox(height: 16),
        if (widget.completed)
          Row(
            children: [
              SvgPicture.asset(
                'assets/icons/checkCircle.svg',
                width: 24,
                height: 24,
              ),
              const SizedBox(width: 8),
              Text(ref.t('courses.article.read')),
            ],
          )
        else
          AppButton(
            label: ref.t('courses.article.markRead'),
            onPressed: widget.onMarkComplete,
          ),
      ],
    );
  }
}

/// Port of ally-mobile (React Native)'s `PlayerTopBar` — an exit (X)
/// button, a section-title eyebrow + item title, an optional item
/// description, the per-section [SegmentedProgressRail], and an overall
/// track-wide completion percentage. Replaces the generic
/// [TabScreenHeader] (used by other screens) for this one, since RN's real
/// player header is its own dedicated shell, not the app-wide one — it has
/// no global progress ring, just this track's own chrome.
class _PlayerTopBar extends ConsumerWidget {
  const _PlayerTopBar({
    required this.sectionTitle,
    required this.itemTitle,
    required this.description,
    required this.sectionItems,
    required this.currentItemId,
    required this.isCompleted,
    required this.overallPct,
    required this.onExit,
  });

  final String sectionTitle;
  final String itemTitle;
  final String? description;
  final List<_FlatTrackItem> sectionItems;
  final String currentItemId;
  final bool Function(TrackDetailItem item) isCompleted;
  final double overallPct;
  final VoidCallback onExit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 8, 16, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              IconButton(
                icon: const Icon(Icons.close),
                tooltip: ref.t('courses.player.exit'),
                onPressed: onExit,
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      sectionTitle,
                      style: const TextStyle(fontSize: 12, color: AppColors.mediumEmphasis),
                    ),
                    Text(itemTitle, style: Theme.of(context).textTheme.titleMedium),
                  ],
                ),
              ),
              Text(
                ref.t('courses.player.overallProgress', {'pct': overallPct.round()}),
                style: const TextStyle(fontSize: 12, color: AppColors.mediumEmphasis),
              ),
            ],
          ),
          if (description != null && description!.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(left: 48, top: 4),
              child: Text(
                description!,
                style: const TextStyle(fontSize: 12, color: AppColors.mediumEmphasis),
              ),
            ),
          const SizedBox(height: 12),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: _SegmentedProgressRail(
              sectionItems: sectionItems,
              currentItemId: currentItemId,
              isCompleted: isCompleted,
            ),
          ),
        ],
      ),
    );
  }
}

/// Port of ally-mobile (React Native)'s `SegmentedProgressRail` — one
/// equal-width bar per item in the *current section only*, filled for a
/// completed item, lightly highlighted for the current item, grey
/// otherwise. Purely visual (no "3 of 8" label — that's the top bar's
/// separate overall-percentage text).
class _SegmentedProgressRail extends StatelessWidget {
  const _SegmentedProgressRail({
    required this.sectionItems,
    required this.currentItemId,
    required this.isCompleted,
  });

  final List<_FlatTrackItem> sectionItems;
  final String currentItemId;
  final bool Function(TrackDetailItem item) isCompleted;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        for (final flatItem in sectionItems)
          Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 2),
              child: Container(
                key: ValueKey('progress-segment-${flatItem.item.id}'),
                height: 4,
                decoration: BoxDecoration(
                  color: isCompleted(flatItem.item)
                      ? AppColors.primary
                      : flatItem.item.id == currentItemId
                      ? AppColors.primary.withValues(alpha: 0.4)
                      : AppColors.lightGray2,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// Port of ally-mobile (React Native)'s `PlayerBottomNav` — a fixed
/// Prev/Next row. Prev is disabled on the first item (always visible,
/// just greyed out — not hidden). Next's label flips to "Finish" on the
/// last item, and in both cases it's disabled until the current item
/// reports completion (`canAdvance`) — confirmed from the real source that
/// `hasNext`/`isLastItem` do NOT separately gate Next once that's true,
/// only `canAdvance` does.
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
  final VoidCallback? onPrev;
  final VoidCallback? onNext;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
      child: Row(
        children: [
          Expanded(
            child: AppButton(
              label: ref.t('courses.player.prev'),
              variant: AppButtonVariant.secondary,
              isDisabled: !hasPrev,
              onPressed: onPrev ?? () {},
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: AppButton(
              label: ref.t(isLastItem ? 'courses.player.finish' : 'courses.player.next'),
              isDisabled: !canAdvance,
              onPressed: onNext ?? () {},
            ),
          ),
        ],
      ),
    );
  }
}
