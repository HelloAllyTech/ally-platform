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
import 'celebration_modal.dart';
import 'game/game_player.dart';
import 'journal/journal_player.dart';
import 'quiz/quiz_player.dart';
import 'video/video_item_player.dart';

/// Full port of ally-mobile (React Native)'s `CourseItemPlayerScreen`
/// (7,700 lines in the original) for ARTICLE, VIDEO, QUIZ, JOURNAL, and
/// GAME item types — real `startTrackItem` content (not a stub), inline
/// article questions, video interjections, the complete 8-question-type
/// quiz engine, debounced journal autosave, and the same HTML5 game
/// bundles the RN and web apps embed. ROLEPLAY/CASE route elsewhere via
/// the existing Simulations/Cases screens, same as the RN app.
class CourseItemPlayerScreen extends ConsumerStatefulWidget {
  const CourseItemPlayerScreen({super.key, required this.item});

  final TrackDetailItem item;

  @override
  ConsumerState<CourseItemPlayerScreen> createState() =>
      _CourseItemPlayerScreenState();
}

class _CourseItemPlayerScreenState
    extends ConsumerState<CourseItemPlayerScreen> {
  StartItemPayload? _payload;
  bool _isLoading = true;
  String? _error;
  bool _completed = false;
  CelebrationKind? _celebration;

  @override
  void initState() {
    super.initState();
    _start();
  }

  Future<void> _start() async {
    try {
      final payload = await ref
          .read(coursesRepositoryProvider)
          .startTrackItem(widget.item.id);
      setState(() {
        _payload = payload;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = '${ref.tr('courses.player.loadFailed')}: $e';
        _isLoading = false;
      });
    }
  }

  Future<void> _markArticleComplete() async {
    final result = await ref
        .read(coursesRepositoryProvider)
        .markArticleRead(widget.item.id);
    if (mounted) _handleCompletion(result);
  }

  /// Mirrors RN's `handleCompletion` — a track-complete celebration always
  /// wins over a section-complete one (a track can't finish without its
  /// last section finishing too, so showing both would be redundant).
  void _handleCompletion(TrackItemCompletionResult result) {
    if (!result.completed) return;
    setState(() {
      _completed = true;
      if (result.trackCompleted) {
        _celebration = CelebrationKind.track;
      } else if (result.sectionCompleted) {
        _celebration = CelebrationKind.section;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Stack(
          children: [
            Column(
              children: [
                TabScreenHeader(title: widget.item.title),
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
    switch (payload.type) {
      case 'QUIZ':
        return QuizPlayer(
          itemId: widget.item.id,
          quiz: payload.quiz!,
          attemptsUsed: payload.attemptsUsed ?? 0,
          maxAttempts: payload.maxAttempts,
          onCompleted: _handleCompletion,
        );
      case 'ARTICLE':
        return _ArticleView(
          payload: payload,
          itemId: widget.item.id,
          completed: _completed,
          onMarkComplete: _markArticleComplete,
        );
      case 'VIDEO':
        return VideoItemPlayer(
          payload: payload,
          itemId: widget.item.id,
          alreadyCompleted: _completed,
          onCompleted: _handleCompletion,
        );
      case 'JOURNAL':
        return JournalPlayer(
          payload: payload,
          itemId: widget.item.id,
          alreadyCompleted: _completed,
          onCompleted: _handleCompletion,
        );
      case 'GAME':
        // RN's `NativeGamePlayer` replaces the usual HTML5 `GamePlayer` for
        // this one game key — it carries a config object instead of
        // loading a bundle.
        if (payload.gameKey == 'BREATHING_EXERCISE' && payload.breathingExercise != null) {
          return _BreathingExerciseIntro(
            payload: payload,
            onCompleted: _handleCompletion,
          );
        }
        return GamePlayer(
          payload: payload,
          itemId: widget.item.id,
          onCompleted: _handleCompletion,
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
  const _BreathingExerciseIntro({required this.payload, required this.onCompleted});

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
