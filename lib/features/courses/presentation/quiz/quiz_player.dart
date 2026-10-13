import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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
  String? _error;

  bool get _attemptsExhausted =>
      widget.maxAttempts != null && widget.attemptsUsed >= widget.maxAttempts!;

  Future<void> _submit() async {
    if (_answers.length < widget.quiz.questions.length) {
      setState(() => _error = 'Please answer every question before submitting.');
      return;
    }
    setState(() {
      _isSubmitting = true;
      _error = null;
    });
    try {
      final result = await ref.read(coursesRepositoryProvider).submitQuizAttempt(
            itemId: widget.itemId,
            answers: widget.quiz.questions.map((q) => _answers[q.id]!).toList(),
          );
      setState(() => _result = result);
      if (result.passed) widget.onCompleted();
    } catch (e) {
      setState(() => _error = 'Failed to submit quiz: $e');
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_attemptsExhausted && _result == null) {
      return const Center(child: Text('No attempts remaining for this quiz.'));
    }

    final resultsByQuestion = {
      for (final r in _result?.questionResults ?? <QuizQuestionResult>[]) r.questionId: r,
    };

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (_result != null)
          Card(
            color: _result!.passed
                ? Colors.green.shade50
                : Colors.orange.shade50,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _result!.passed ? 'Passed!' : 'Not passed',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  if (_result!.scorePct != null)
                    Text('Score: ${_result!.scorePct!.toStringAsFixed(0)}% '
                        '(pass: ${_result!.passScore}%)'),
                  Text('Attempt ${_result!.attemptsUsed}'
                      '${_result!.maxAttempts != null ? " of ${_result!.maxAttempts}" : ""}'),
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
            child: Text(_error!, style: const TextStyle(color: Colors.red)),
          ),
        if (_result == null)
          FilledButton(
            onPressed: _isSubmitting ? null : _submit,
            child: _isSubmitting
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('Submit quiz'),
          )
        else if (!_result!.passed && !_attemptsExhausted)
          FilledButton(
            onPressed: () => setState(() {
              _result = null;
              _answers.clear();
            }),
            child: const Text('Try again'),
          ),
      ],
    );
  }
}
