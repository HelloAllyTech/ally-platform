import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/localization/translate_ref.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/app_button.dart';
import '../../../../core/widgets/app_card.dart';
import '../../data/courses_repository.dart';
import '../../data/quiz_models.dart';
import 'quiz_question_widget.dart';

/// Orchestrates a full quiz attempt: renders every question via
/// [QuizQuestionWidget], collects one [QuizAnswerInput] per question, and
/// submits them all together on "Submit quiz" — matching ally-mobile
/// (React Native)'s `QuizItemPlayer.tsx` + `QuizResults.tsx` flow (one
/// attempt submission, then a results screen with per-question grading).
class QuizPlayer extends ConsumerStatefulWidget {
  const QuizPlayer({
    super.key,
    required this.itemId,
    required this.quiz,
    required this.attemptsUsed,
    required this.maxAttempts,
    required this.onCompleted,
  });

  final String itemId;
  final SanitizedQuiz quiz;
  final int attemptsUsed;
  final int? maxAttempts;
  final VoidCallback onCompleted;

  @override
  ConsumerState<QuizPlayer> createState() => _QuizPlayerState();
}

class _QuizPlayerState extends ConsumerState<QuizPlayer> {
  final Map<String, QuizAnswerInput> _answers = {};
  QuizAttemptResult? _result;
  bool _isSubmitting = false;
  bool _started = false;
  String? _error;

  bool get _attemptsExhausted =>
      widget.maxAttempts != null && widget.attemptsUsed >= widget.maxAttempts!;

  Future<void> _submit() async {
    if (_answers.length < widget.quiz.questions.length) {
      setState(() => _error = ref.tr('courses.quiz.question.answerAllError'));
      return;
    }
    setState(() {
      _isSubmitting = true;
      _error = null;
    });
    try {
      final result = await ref
          .read(coursesRepositoryProvider)
          .submitQuizAttempt(
            itemId: widget.itemId,
            answers: widget.quiz.questions.map((q) => _answers[q.id]!).toList(),
          );
      setState(() => _result = result);
      if (result.passed) widget.onCompleted();
    } catch (e) {
      setState(
        () => _error = '${ref.tr('courses.quiz.question.submitError')}: $e',
      );
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_started) {
      return _QuizIntro(
        quiz: widget.quiz,
        attemptsUsed: widget.attemptsUsed,
        maxAttempts: widget.maxAttempts,
        onStart: () => setState(() => _started = true),
      );
    }

    final resultsByQuestion = {
      for (final r in _result?.questionResults ?? <QuizQuestionResult>[])
        r.questionId: r,
    };

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (_result != null)
          AppCard(
            variant: AppCardVariant.flat,
            child: Container(
              color: _result!.passed
                  ? Colors.green.shade50
                  : Colors.orange.shade50,
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _result!.passed
                        ? ref.t('courses.quiz.results.passed')
                        : ref.t('courses.quiz.results.failed'),
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  if (_result!.scorePct != null)
                    Text(
                      ref.t('courses.quiz.results.scoreSummary', {
                        'score': _result!.scorePct!.toStringAsFixed(0),
                        'pass': _result!.passScore,
                      }),
                    ),
                  Text(
                    _result!.maxAttempts != null
                        ? ref.t('courses.quiz.results.attemptsUsed', {
                            'used': _result!.attemptsUsed,
                            'max': _result!.maxAttempts,
                          })
                        : ref.t('courses.quiz.results.attemptsUsedNoMax', {
                            'used': _result!.attemptsUsed,
                          }),
                  ),
                ],
              ),
            ),
          ),
        const SizedBox(height: 16),
        for (final question in widget.quiz.questions)
          QuizQuestionWidget(
            question: question,
            showResult: resultsByQuestion[question.id],
            onChanged: (answer) => _answers[question.id] = answer,
          ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text(
              _error!,
              style: const TextStyle(color: AppColors.red400),
            ),
          ),
        if (_result == null)
          AppButton(
            label: ref.t('courses.quiz.question.submit'),
            isLoading: _isSubmitting,
            onPressed: _submit,
          )
        else if (!_result!.passed && !_attemptsExhausted)
          AppButton(
            label: ref.t('courses.quiz.results.retry'),
            onPressed: () => setState(() {
              _result = null;
              _answers.clear();
            }),
          ),
      ],
    );
  }
}

/// Port of ally-mobile (React Native)'s `QuizIntro.tsx` — the landing card
/// shown before a quiz's questions: question count, pass score (hidden for
/// a pure survey, where no question actually contributes points), and
/// attempts remaining, with Start disabled once attempts are exhausted.
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
    final attemptsLeft = maxAttempts == null
        ? null
        : (maxAttempts! - attemptsUsed).clamp(0, maxAttempts!);
    final canStart = attemptsLeft == null || attemptsLeft > 0;
    final isSurvey =
        quiz.totalPoints == 0 || quiz.questions.every((q) => !q.graded);

    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('📝', style: TextStyle(fontSize: 28)),
            const SizedBox(height: 16),
            Text(
              ref.t('courses.quiz.intro.title'),
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 16),
            Text(
              ref.t(
                quiz.questions.length == 1
                    ? 'courses.quiz.intro.questionCount_one'
                    : 'courses.quiz.intro.questionCount_other',
                {'count': quiz.questions.length},
              ),
            ),
            if (!isSurvey)
              Text(
                ref.t('courses.quiz.intro.passScore', {
                  'score': quiz.passScore,
                }),
              ),
            Text(
              attemptsLeft == null
                  ? ref.t('courses.quiz.intro.unlimitedAttempts')
                  : ref.t(
                      attemptsLeft == 1
                          ? 'courses.quiz.intro.attemptsLeft_one'
                          : 'courses.quiz.intro.attemptsLeft_other',
                      {'count': attemptsLeft},
                    ),
            ),
            const SizedBox(height: 24),
            AppButton(
              label: canStart
                  ? ref.t('courses.quiz.intro.start')
                  : ref.t('courses.quiz.intro.noAttemptsLeft'),
              isDisabled: !canStart,
              onPressed: onStart,
            ),
          ],
        ),
      ),
    );
  }
}
