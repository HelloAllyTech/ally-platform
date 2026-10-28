import 'dart:async';

import 'package:confetti/confetti.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../../core/localization/translate_ref.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/rn_scale.dart';
import '../../../../core/widgets/html_rich_text.dart';
import '../../../simulations/presentation/widgets/circular_progress.dart';
import '../../data/course_models.dart';
import '../../data/courses_repository.dart';
import '../../data/quiz_answer_state.dart';
import '../../data/quiz_models.dart';
import '../course_button.dart';
import '../course_styles.dart';
import '../question_media.dart';
import 'quiz_question_widget.dart';

enum _Phase { intro, questions, results }

/// Port of RN `components/players/quiz/QuizItemPlayer.tsx`: [_QuizIntro],
/// then one question per page ("Question x of y", Back / Next / Submit
/// gated on the current question being answered), a single submit, and
/// [_QuizResults]. A PENDING_GRADING attempt offers "Finish grading"
/// (regrade); a failed attempt with attempts left offers Retry, which
/// re-starts the item for a fresh (reshuffled) quiz and attempt count. A
/// pass that completes the item fires confetti (unless reduce motion).
class QuizPlayer extends ConsumerStatefulWidget {
  const QuizPlayer({
    super.key,
    required this.itemId,
    required this.quiz,
    required this.attemptsUsed,
    required this.maxAttempts,
    required this.onCompleted,
    this.onRequestNext,
  });

  final String itemId;
  final SanitizedQuiz quiz;
  final int attemptsUsed;
  final int? maxAttempts;
  final void Function(TrackItemCompletionResult result) onCompleted;

  /// RN `onRequestNext` (goNextOrOverview), behind the results' Next.
  final VoidCallback? onRequestNext;

  @override
  ConsumerState<QuizPlayer> createState() => _QuizPlayerState();
}

class _QuizPlayerState extends ConsumerState<QuizPlayer> {
  late SanitizedQuiz _quiz = widget.quiz;
  late int _attemptsUsed = widget.attemptsUsed;
  _Phase _phase = _Phase.intro;
  int _current = 0;
  Map<String, QuizAnswerState> _answers = {};
  QuizAttemptResult? _result;
  bool _isSubmitting = false;
  bool _isRegrading = false;
  bool _showConfetti = false;

  @override
  void initState() {
    super.initState();
    _resetAnswers(_quiz);
  }

  void _resetAnswers(SanitizedQuiz quiz) {
    _answers = {for (final q in quiz.questions) q.id: initialAnswerState(q)};
  }

  void _startQuiz() => setState(() {
    _resetAnswers(_quiz);
    _current = 0;
    _result = null;
    _phase = _Phase.questions;
  });

  void _applyAttemptResult(QuizAttemptResult attempt) {
    setState(() {
      _result = attempt;
      _attemptsUsed = attempt.attemptsUsed;
      _phase = _Phase.results;
    });
    if (attempt.passed && attempt.itemCompleted) {
      if (!MediaQuery.of(context).disableAnimations) setState(() => _showConfetti = true);
      widget.onCompleted(
        TrackItemCompletionResult(
          completed: attempt.itemCompleted,
          sectionCompleted: attempt.sectionCompleted,
          trackCompleted: attempt.trackCompleted,
        ),
      );
    }
  }

  Future<void> _handleSubmit() async {
    if (_isSubmitting) return;
    setState(() => _isSubmitting = true);
    try {
      final attempt = await ref
          .read(coursesRepositoryProvider)
          .submitQuizAttempt(
            itemId: widget.itemId,
            answers: [for (final q in _quiz.questions) toAnswerInput(q, _answers[q.id] ?? const QuizAnswerState())],
          );
      if (mounted) _applyAttemptResult(attempt);
    } catch (_) {
      // Stays on the last question so the learner can retry submitting.
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  Future<void> _handleRegrade() async {
    final result = _result;
    if (result == null || _isRegrading) return;
    setState(() => _isRegrading = true);
    try {
      final attempt = await ref
          .read(coursesRepositoryProvider)
          .regradeQuizAttempt(itemId: widget.itemId, attemptId: result.attemptId);
      if (mounted) _applyAttemptResult(attempt);
    } catch (_) {
      // Button stays available so the learner can retry.
    } finally {
      if (mounted) setState(() => _isRegrading = false);
    }
  }

  Future<void> _handleRetry() async {
    try {
      final fresh = await ref.read(coursesRepositoryProvider).startTrackItem(widget.itemId);
      if (!mounted) return;
      setState(() {
        if (fresh.type == 'QUIZ' && fresh.quiz != null) {
          _quiz = fresh.quiz!;
          _attemptsUsed = fresh.attemptsUsed ?? _attemptsUsed;
        }
        _resetAnswers(_quiz);
        _current = 0;
        _result = null;
        _phase = _Phase.questions;
      });
    } catch (_) {
      // Results stay up so the learner can retry.
    }
  }

  @override
  Widget build(BuildContext context) {
    final maxAttempts = widget.maxAttempts;
    switch (_phase) {
      case _Phase.intro:
        return _QuizIntro(
          quiz: _quiz,
          attemptsUsed: _attemptsUsed,
          maxAttempts: maxAttempts,
          onStart: _startQuiz,
        );
      case _Phase.results when _result != null:
        final attemptsLeft = maxAttempts == null ? 1 << 30 : maxAttempts - _attemptsUsed;
        return Stack(
          children: [
            Positioned.fill(
              child: _QuizResults(
                result: _result!,
                questions: _quiz.questions,
                answers: _answers,
                isRegrading: _isRegrading,
                canRetry: attemptsLeft > 0,
                onRegrade: _handleRegrade,
                onRetry: _handleRetry,
                onNext: widget.onRequestNext ?? () {},
              ),
            ),
            if (_showConfetti)
              _QuizConfetti(onEnd: () {
                if (mounted) setState(() => _showConfetti = false);
              }),
          ],
        );
      case _Phase.results:
      case _Phase.questions:
        return _buildQuestion(context);
    }
  }

  Widget _buildQuestion(BuildContext context) {
    final questions = _quiz.questions;
    if (questions.isEmpty) return const SizedBox.shrink();
    final question = questions[_current];
    final state = _answers[question.id] ?? const QuizAnswerState();
    final answered = isQuizQuestionAnswered(question, state);
    final isLast = _current == questions.length - 1;
    final icon = RnSize.of(context).raw(14);
    final promptHtml = question.promptHtml;

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
          child: Align(
            alignment: Alignment.centerLeft,
            child: Text(
              ref.t('courses.quiz.question.progress', {'current': _current + 1, 'total': questions.length}),
              key: const Key('quiz-progress'),
              style: CourseText.system(const TextStyle(fontSize: 14), AppColors.mediumEmphasis),
            ),
          ),
        ),
        Expanded(
          child: SingleChildScrollView(
            key: ValueKey('quiz-question-${question.id}'),
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (promptHtml != null && promptHtml.isNotEmpty)
                  Padding(padding: const EdgeInsets.only(bottom: 8), child: HtmlRichText(html: promptHtml))
                else
                  Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: Text(
                      question.prompt,
                      style: CourseText.system(const TextStyle(fontSize: 16), AppColors.highEmphasis),
                    ),
                  ),
                QuestionMediaView(media: question.media),
                QuizQuestionWidget(
                  key: ValueKey('quiz-widget-${question.id}'),
                  question: question,
                  state: state,
                  onChanged: (next) => setState(() => _answers[question.id] = next),
                ),
              ],
            ),
          ),
        ),
        // styles.footer: row, gap 12, padding 16, borderTop 0.5.
        Container(
          padding: const EdgeInsets.all(16),
          decoration: const BoxDecoration(
            border: Border(top: BorderSide(color: AppColors.strokePrimary, width: 0.5)),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: CourseButton(
                  key: const Key('quiz-back'),
                  label: ref.t('courses.quiz.question.back'),
                  variant: CourseButtonVariant.secondary,
                  isDisabled: _current == 0,
                  onPressed: () => setState(() => _current = (_current - 1).clamp(0, questions.length - 1)),
                  iconLeft: SizedBox(
                    width: icon,
                    height: icon,
                    child: SvgPicture.asset('assets/icons/leftArrowIcon.svg'),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: isLast
                    ? CourseButton(
                        key: const Key('quiz-submit'),
                        label: ref.t('courses.quiz.question.submit'),
                        isDisabled: !answered || _isSubmitting,
                        onPressed: _handleSubmit,
                      )
                    : CourseButton(
                        key: const Key('quiz-next-question'),
                        label: ref.t('courses.quiz.question.next'),
                        isDisabled: !answered,
                        onPressed: () => setState(() => _current = (_current + 1).clamp(0, questions.length - 1)),
                        iconRight: SizedBox(
                          width: icon,
                          height: icon,
                          child: SvgPicture.asset('assets/icons/arrowRight.svg'),
                        ),
                      ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// RN `<ConfettiCannon fadeOut count={90} origin={{x: 0, y: 0}}>`.
class _QuizConfetti extends StatefulWidget {
  const _QuizConfetti({required this.onEnd});

  final VoidCallback onEnd;

  @override
  State<_QuizConfetti> createState() => _QuizConfettiState();
}

class _QuizConfettiState extends State<_QuizConfetti> {
  final _controller = ConfettiController(duration: const Duration(seconds: 2));
  Timer? _endTimer;

  @override
  void initState() {
    super.initState();
    _controller.play();
    // RN `fadeOut` + `onAnimationEnd`: the burst is gone after a few seconds.
    _endTimer = Timer(const Duration(seconds: 4), widget.onEnd);
  }

  @override
  void dispose() {
    _endTimer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Align(
    alignment: Alignment.topLeft,
    child: ConfettiWidget(
      key: const Key('quiz-confetti'),
      confettiController: _controller,
      blastDirection: 0.8,
      emissionFrequency: 0,
      numberOfParticles: 30,
      maxBlastForce: 30,
      minBlastForce: 10,
      gravity: 0.3,
    ),
  );
}

/// Port of RN `quiz/QuizIntro.tsx`.
class _QuizIntro extends ConsumerWidget {
  const _QuizIntro({
    required this.quiz,
    required this.attemptsUsed,
    required this.maxAttempts,
    required this.onStart,
  });

  final SanitizedQuiz quiz;
  final int attemptsUsed;
  final int? maxAttempts;
  final VoidCallback onStart;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final attemptsLeft = maxAttempts == null ? null : (maxAttempts! - attemptsUsed).clamp(0, 1 << 30);
    final canStart = attemptsLeft == null || attemptsLeft > 0;
    final isSurvey = quiz.totalPoints == 0 || quiz.questions.every((q) => !q.graded);
    final meta = CourseText.roboto(CourseType.bodySmall, AppColors.mediumEmphasis);
    final count = quiz.questions.length;

    // styles.container: centred, gap 16, paddingHorizontal 24.
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: withGap<Widget>([
            Container(
              width: 64,
              height: 64,
              alignment: Alignment.center,
              decoration: const BoxDecoration(color: AppColors.lightBlue50, shape: BoxShape.circle),
              child: const Text('📝', style: TextStyle(fontFamily: courseSystemFont, fontSize: 28)),
            ),
            Text(
              ref.t('courses.quiz.intro.title'),
              style: CourseText.serifMedium(CourseType.bodyLarge, AppColors.highEmphasis, weight: FontWeight.w500),
            ),
            Column(
              children: withGap<Widget>([
                Text(
                  ref.t(
                    count == 1 ? 'courses.quiz.intro.questionCount_one' : 'courses.quiz.intro.questionCount_other',
                    {'count': count},
                  ),
                  style: meta,
                ),
                if (!isSurvey) Text(ref.t('courses.quiz.intro.passScore', {'score': quiz.passScore}), style: meta),
                Text(
                  attemptsLeft == null
                      ? ref.t('courses.quiz.intro.unlimitedAttempts')
                      : ref.t(
                          attemptsLeft == 1 ? 'courses.quiz.intro.attemptsLeft_one' : 'courses.quiz.intro.attemptsLeft_other',
                          {'count': attemptsLeft},
                        ),
                  style: meta,
                ),
              ], () => const SizedBox(height: 4)),
            ),
            CourseButton(
              key: const Key('quiz-start'),
              label: canStart ? ref.t('courses.quiz.intro.start') : ref.t('courses.quiz.intro.noAttemptsLeft'),
              isDisabled: !canStart,
              onPressed: onStart,
            ),
          ], () => const SizedBox(height: 16)),
        ),
      ),
    );
  }
}

/// RN `formatCorrectAnswer`: the answer key as the text the learner saw.
/// Ids that no longer resolve are dropped.
String formatQuizCorrectAnswer(
  SanitizedQuizQuestion? question,
  QuizCorrectAnswer answer,
  String Function(String key) t,
) {
  if (question == null) return '';
  switch (question.type) {
    case QuizQuestionType.mcqSingle:
    case QuizQuestionType.mcqMulti:
      final byId = {for (final o in question.options ?? const <QuizOption>[]) o.id: o.text};
      return [for (final id in answer.selectedOptionIds ?? const <String>[]) ?byId[id]].join(', ');
    case QuizQuestionType.trueFalse:
      return answer.booleanAnswer == true ? t('courses.quiz.question.true') : t('courses.quiz.question.false');
    case QuizQuestionType.ordering:
      final byId = {for (final o in question.items ?? const <QuizOption>[]) o.id: o.text};
      return [for (final id in answer.orderedItemIds ?? const <String>[]) ?byId[id]].join(' → ');
    case QuizQuestionType.matching:
      final left = {for (final o in question.left ?? const <QuizOption>[]) o.id: o.text};
      final right = {for (final o in question.right ?? const <QuizOption>[]) o.id: o.text};
      return [
        for (final p in answer.pairs ?? const <({String leftId, String rightId})>[])
          if (left[p.leftId] != null && right[p.rightId] != null) '${left[p.leftId]} → ${right[p.rightId]}',
      ].join(', ');
    case QuizQuestionType.fillBlank:
      return [for (final b in answer.blanks ?? const []) b.acceptedAnswers.join(' / ')].join(', ');
    default:
      return '';
  }
}

/// Port of RN `quiz/QuizResults.tsx`: score ring + pass/fail pill (or the
/// survey's "Responses submitted"), attempts used, a per-question accordion
/// (status, correct answer for a wrong one, explanation, AI feedback;
/// likert rows show the learner's responses), and the one CTA that fits:
/// Finish grading, Next, or Retry.
class _QuizResults extends ConsumerWidget {
  const _QuizResults({
    required this.result,
    required this.questions,
    required this.answers,
    required this.isRegrading,
    required this.canRetry,
    required this.onRegrade,
    required this.onRetry,
    required this.onNext,
  });

  final QuizAttemptResult result;
  final List<SanitizedQuizQuestion> questions;
  final Map<String, QuizAnswerState> answers;
  final bool isRegrading;
  final bool canRetry;
  final VoidCallback onRegrade;
  final VoidCallback onRetry;
  final VoidCallback onNext;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final size = RnSize.of(context);
    final byId = {for (final q in questions) q.id: q};
    final isSurvey = result.scorePct == null;
    final hasPending = result.status == 'PENDING_GRADING' || result.questionResults.any((q) => q.isPending);
    final score = (result.scorePct ?? 0).round();

    final children = <Widget>[
      if (isSurvey) ...[
        Container(
          width: 96,
          height: 96,
          alignment: Alignment.center,
          decoration: const BoxDecoration(color: AppColors.green50, shape: BoxShape.circle),
          child: SizedBox(
            width: size.raw(40),
            height: size.raw(40),
            child: SvgPicture.asset('assets/icons/checkCircle.svg'),
          ),
        ),
        Text(
          ref.t('courses.quiz.results.responsesSubmitted'),
          key: const Key('quiz-results-survey'),
          style: CourseText.serifMedium(CourseType.bodyLarge, AppColors.highEmphasis, weight: FontWeight.w500),
        ),
      ] else ...[
        CircularProgress(
          key: const Key('quiz-score-ring'),
          progress: score,
          size: size.raw(96),
          strokeWidth: size.raw(8),
          progressColor: result.passed ? AppColors.green400 : AppColors.red400,
          child: Text(
            '$score%',
            style: CourseText.serifMedium(CourseType.bodyLarge, AppColors.highEmphasis, weight: FontWeight.w500),
          ),
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
          decoration: BoxDecoration(
            color: result.passed ? AppColors.green50 : AppColors.red50,
            borderRadius: BorderRadius.circular(20),
          ),
          child: Text(
            result.passed ? ref.t('courses.quiz.results.passed') : ref.t('courses.quiz.results.failed'),
            style: CourseText.serifMedium(
              CourseType.bodySmall,
              result.passed ? AppColors.green800 : AppColors.red600,
              weight: FontWeight.w500,
            ),
          ),
        ),
      ],
      if (result.maxAttempts != null)
        Text(
          ref.t('courses.quiz.results.attemptsUsed', {'used': result.attemptsUsed, 'max': result.maxAttempts}),
          style: CourseText.roboto(CourseType.bodyTiny, AppColors.lowEmphasis),
        ),
      Padding(
        padding: const EdgeInsets.only(top: 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: withGap<Widget>([
            for (var i = 0; i < result.questionResults.length; i++)
              _QuestionRow(
                index: i,
                question: byId[result.questionResults[i].questionId],
                result: result.questionResults[i],
                answerState: answers[result.questionResults[i].questionId],
              ),
          ], () => const SizedBox(height: 8)),
        ),
      ),
      Padding(
        padding: const EdgeInsets.only(top: 16),
        child: hasPending
            ? CourseButton(
                key: const Key('quiz-finish-grading'),
                label: isRegrading ? ref.t('courses.quiz.results.grading') : ref.t('courses.quiz.results.finishGrading'),
                isDisabled: isRegrading,
                onPressed: onRegrade,
              )
            : (isSurvey || result.passed)
            ? CourseButton(key: const Key('quiz-next'), label: ref.t('courses.quiz.results.next'), onPressed: onNext)
            : canRetry
            ? CourseButton(key: const Key('quiz-retry'), label: ref.t('courses.quiz.results.retry'), onPressed: onRetry)
            : const SizedBox.shrink(),
      ),
    ];

    return SingleChildScrollView(
      key: const Key('quiz-results'),
      padding: const EdgeInsets.all(24),
      child: Column(children: withGap(children, () => const SizedBox(height: 12))),
    );
  }
}

class _QuestionRow extends ConsumerStatefulWidget {
  const _QuestionRow({required this.index, required this.question, required this.result, this.answerState});

  final int index;
  final SanitizedQuizQuestion? question;
  final QuizQuestionResult result;
  final QuizAnswerState? answerState;

  @override
  ConsumerState<_QuestionRow> createState() => _QuestionRowState();
}

class _QuestionRowState extends ConsumerState<_QuestionRow> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final result = widget.result;
    final question = widget.question;
    final graded = result.graded;
    final isPending = result.isPending;
    final isLikert = question?.type == QuizQuestionType.likertScale;
    final statusText = isPending
        ? ref.t('courses.quiz.results.pendingGrading')
        : result.correct == null
        ? ref.t('courses.quiz.results.notScored')
        : result.correct!
        ? ref.t('courses.quiz.results.correct')
        : ref.t('courses.quiz.results.incorrect');
    final dotColor = !graded
        ? AppColors.grey400
        : isPending
        ? AppColors.amber300
        : result.correct == true
        ? AppColors.green400
        : AppColors.red400;
    final detailText = CourseText.roboto(CourseType.bodySmall, AppColors.mediumEmphasis);
    const labelStyle = TextStyle(fontWeight: FontWeight.w500, color: AppColors.highEmphasis);
    final correctAnswer = result.correctAnswer;
    final correctText = correctAnswer != null && result.correct == false
        ? formatQuizCorrectAnswer(question, correctAnswer, ref.t)
        : '';

    Widget labelled(String labelKey, String value) => Text.rich(
      TextSpan(
        style: detailText,
        children: [
          TextSpan(text: '${ref.t(labelKey)}: ', style: labelStyle),
          TextSpan(text: value),
        ],
      ),
    );

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: AppColors.strokePrimary),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          GestureDetector(
            key: Key('question-row-${result.questionId}'),
            behavior: HitTestBehavior.opaque,
            onTap: () => setState(() => _open = !_open),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Container(
                    width: 14,
                    height: 14,
                    decoration: BoxDecoration(color: dotColor, shape: BoxShape.circle),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      '${widget.index + 1}. ${question?.prompt ?? ''}',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: CourseText.serifMedium(CourseType.bodySmall, AppColors.highEmphasis, weight: FontWeight.w500),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Text(
                    !graded ? ref.t('courses.quiz.results.notScored') : '${result.pointsAwarded}/${result.pointsPossible}',
                    style: CourseText.roboto(CourseType.bodyTiny, AppColors.lowEmphasis),
                  ),
                ],
              ),
            ),
          ),
          if (_open)
            Container(
              key: Key('question-row-detail-${result.questionId}'),
              padding: const EdgeInsets.all(12),
              decoration: const BoxDecoration(
                border: Border(top: BorderSide(color: AppColors.strokePrimary, width: 0.5)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  QuestionMediaView(media: question?.media),
                  if (isLikert && question != null)
                    _LikertResponses(question: question, ratings: widget.answerState?.ratings)
                  else ...[
                    Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: Text(
                        statusText,
                        style: CourseText.serifMedium(CourseType.bodySmall, AppColors.highEmphasis, weight: FontWeight.w500),
                      ),
                    ),
                    if (correctText.isNotEmpty) labelled('courses.quiz.results.correctAnswer', correctText),
                    if ((result.explanation ?? '').isNotEmpty)
                      labelled('courses.quiz.results.explanation', result.explanation!),
                    if ((result.llmFeedback ?? '').isNotEmpty)
                      Container(
                        key: const Key('quiz-ai-feedback'),
                        margin: const EdgeInsets.only(top: 8),
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(color: AppColors.grey50, borderRadius: BorderRadius.circular(8)),
                        child: labelled('courses.quiz.results.feedback', result.llmFeedback!),
                      ),
                  ],
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _LikertResponses extends ConsumerWidget {
  const _LikertResponses({required this.question, this.ratings});

  final SanitizedQuizQuestion question;
  final Map<String, String>? ratings;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scaleById = {for (final s in question.scale ?? const <QuizOption>[]) s.id: s.text};
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          ref.t('courses.quiz.results.yourResponses'),
          style: const TextStyle(
            fontFamily: courseSystemFont,
            fontWeight: FontWeight.w500,
            color: AppColors.highEmphasis,
          ),
        ),
        const SizedBox(height: 4),
        ...withGap<Widget>([
          for (final statement in question.statements ?? const <QuizOption>[])
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(statement.text, style: CourseText.roboto(CourseType.bodySmall, AppColors.mediumEmphasis)),
                ),
                const SizedBox(width: 8),
                Text(
                  scaleById[ratings?[statement.id] ?? ''] ?? '—',
                  style: CourseText.serifMedium(CourseType.bodySmall, AppColors.primary, weight: FontWeight.w500),
                ),
              ],
            ),
        ], () => const SizedBox(height: 6)),
      ],
    );
  }
}
