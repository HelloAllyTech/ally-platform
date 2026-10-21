import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/widgets/app_button.dart';
import 'package:ally_mobile_flutter/features/courses/data/courses_repository.dart';
import 'package:ally_mobile_flutter/features/courses/data/quiz_models.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/quiz/quiz_player.dart';

import '../../../../support/pump_app.dart';

class MockCoursesRepository extends Mock implements CoursesRepository {}

SanitizedQuiz _twoQuestionQuiz() => SanitizedQuiz.fromJson({
  'settings': {'passScore': 70, 'maxAttempts': 3},
  'totalPoints': 10,
  'questions': [
    {
      'id': 'q-1',
      'type': 'mcq_single',
      'prompt': 'Pick A',
      'options': [
        {'id': 'a', 'text': 'Option A'},
        {'id': 'b', 'text': 'Option B'},
      ],
    },
    {
      'id': 'q-2',
      'type': 'mcq_single',
      'prompt': 'Pick C',
      'options': [
        {'id': 'c', 'text': 'Option C'},
        {'id': 'd', 'text': 'Option D'},
      ],
    },
  ],
});

// `questionResults` is deliberately left empty: this file's scope is the
// top-level quiz flow (validation, submission, pass/fail banner, retry,
// attempts-exhausted), not per-question result rendering, which
// `quiz_question_widget_test.dart` already covers directly with its own
// `showResult` cases.
Map<String, dynamic> _attemptResultJson({
  required bool passed,
  int attemptsUsed = 1,
}) => {
  'attemptId': 'attempt-1',
  'scorePct': passed ? 90.0 : 40.0,
  'passed': passed,
  'passScore': 70,
  'attemptsUsed': attemptsUsed,
  'maxAttempts': 3,
  'questionResults': <dynamic>[],
};

Future<void> _answerBothQuestions(WidgetTester tester) async {
  await tester.tap(find.text('Option A'));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Option C'));
  await tester.pumpAndSettle();
}

Future<void> _startQuiz(WidgetTester tester) async {
  await tester.tap(find.text('Start quiz'));
  await tester.pumpAndSettle();
}

void main() {
  // All scenarios share a single `testWidgets` body (rather than one
  // `testWidgets` per scenario): `pumpApp` resolves bundled translations
  // via a real asset read, and that real read only reliably resolves
  // within the `testWidgets` call that first triggers it in this test
  // runner — a second, independent `testWidgets` in the same file never
  // observes `localizationControllerProvider` resolve and silently falls
  // back to raw translation keys. Re-pumping fresh widgets repeatedly
  // *within* one `testWidgets` works fine (verified), so each scenario
  // that needs a distinct quiz attempt below pumps `QuizPlayer` again
  // with a distinct `Key` (forcing a fresh `State` instead of Flutter
  // reusing the previous scenario's, since `QuizPlayer` is the same
  // runtime type each time). The "Try again" scenario is the exception:
  // it's a stateful transition *within* the already-mounted 'failed'
  // instance (no remount), so it continues interacting with that pump
  // instead of pumping a new one.
  testWidgets(
    'QuizPlayer validates, submits, shows results, retries, and locks out',
    (tester) async {
      final repository = MockCoursesRepository();

      // --- validation: submitting before every question is answered ---
      var completed = false;
      await pumpApp(
        tester,
        QuizPlayer(
          key: const ValueKey('validation'),
          itemId: 'item-1',
          quiz: _twoQuestionQuiz(),
          attemptsUsed: 0,
          maxAttempts: 3,
          onCompleted: (_) => completed = true,
        ),
        overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
      );

      // --- intro screen: question count, pass score, attempts left ---
      expect(find.text('2 questions'), findsOneWidget);
      expect(find.text('Pass score: 70%'), findsOneWidget);
      expect(find.text('3 attempts left'), findsOneWidget);
      expect(
        find.text('Pick A'),
        findsNothing,
        reason: 'questions not shown until Start is tapped',
      );

      await _startQuiz(tester);

      await tester.tap(find.text('Option A'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Submit quiz'));
      await tester.pumpAndSettle();

      expect(
        find.text('Please answer every question before submitting.'),
        findsOneWidget,
      );
      verifyNever(
        () => repository.submitQuizAttempt(
          itemId: any(named: 'itemId'),
          answers: any(named: 'answers'),
        ),
      );
      expect(completed, false);

      // --- submitting all answers renders the passed banner ---
      final captured = <List<QuizAnswerInput>>[];
      when(
        () => repository.submitQuizAttempt(
          itemId: any(named: 'itemId'),
          answers: any(named: 'answers'),
        ),
      ).thenAnswer((invocation) async {
        captured.add(
          invocation.namedArguments[#answers] as List<QuizAnswerInput>,
        );
        return QuizAttemptResult.fromJson(_attemptResultJson(passed: true));
      });

      await pumpApp(
        tester,
        QuizPlayer(
          key: const ValueKey('passed'),
          itemId: 'item-1',
          quiz: _twoQuestionQuiz(),
          attemptsUsed: 0,
          maxAttempts: 3,
          onCompleted: (_) => completed = true,
        ),
        overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
      );

      await _startQuiz(tester);
      await _answerBothQuestions(tester);
      await tester.tap(find.text('Submit quiz'));
      await tester.pumpAndSettle();

      verify(
        () => repository.submitQuizAttempt(
          itemId: 'item-1',
          answers: any(named: 'answers'),
        ),
      ).called(1);
      expect(captured, hasLength(1));
      final sentAnswers = {
        for (final a in captured.first) a.questionId: a.toJson(),
      };
      expect(sentAnswers['q-1'], {
        'questionId': 'q-1',
        'selectedOptionIds': ['a'],
      });
      expect(sentAnswers['q-2'], {
        'questionId': 'q-2',
        'selectedOptionIds': ['c'],
      });
      expect(find.text('Passed'), findsOneWidget);
      expect(find.text('Score: 90% (pass: 70%)'), findsOneWidget);
      expect(completed, true);

      // --- failed attempt renders the failed banner and skips onCompleted ---
      completed = false;
      when(
        () => repository.submitQuizAttempt(
          itemId: any(named: 'itemId'),
          answers: any(named: 'answers'),
        ),
      ).thenAnswer(
        (_) async =>
            QuizAttemptResult.fromJson(_attemptResultJson(passed: false)),
      );

      await pumpApp(
        tester,
        QuizPlayer(
          key: const ValueKey('failed'),
          itemId: 'item-1',
          quiz: _twoQuestionQuiz(),
          attemptsUsed: 0,
          maxAttempts: 3,
          onCompleted: (_) => completed = true,
        ),
        overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
      );

      await _startQuiz(tester);
      await _answerBothQuestions(tester);
      await tester.tap(find.text('Submit quiz'));
      await tester.pumpAndSettle();

      expect(find.text('Failed'), findsOneWidget);
      expect(completed, false);

      // --- "Try again" resets answers and state when attempts remain ---
      // This is a stateful transition within the *same* mounted QuizPlayer
      // (the retry button just clears _result/_answers via setState — no
      // remount), so it's driven by continuing to interact with the
      // already-pumped 'failed' instance above rather than pumping a fresh
      // one.
      await tester.tap(find.text('Retry quiz'));
      await tester.pumpAndSettle();

      // Back to the unanswered state: submit button is back, result banner
      // gone, and the previous answers were cleared (submitting immediately
      // re-triggers the validation error instead of re-submitting stale
      // answers).
      expect(find.text('Submit quiz'), findsOneWidget);
      expect(find.text('Failed'), findsNothing);

      await tester.tap(find.text('Submit quiz'));
      await tester.pumpAndSettle();
      expect(
        find.text('Please answer every question before submitting.'),
        findsOneWidget,
      );

      // --- no attempts remaining ---
      await pumpApp(
        tester,
        QuizPlayer(
          key: const ValueKey('exhausted'),
          itemId: 'item-1',
          quiz: _twoQuestionQuiz(),
          attemptsUsed: 3,
          maxAttempts: 3,
          onCompleted: (_) {},
        ),
        overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
      );

      expect(find.text('No attempts remaining'), findsOneWidget);
      expect(find.text('Submit quiz'), findsNothing);
      expect(find.text('Pick A'), findsNothing);
      expect(
        tester.widget<AppButton>(find.byType(AppButton)).isDisabled,
        isTrue,
        reason: 'Start is disabled once attempts are exhausted, not hidden entirely',
      );

      // --- a pure survey (no graded questions) hides the pass score, and
      // unlimited attempts (maxAttempts: null) shows that copy instead of a
      // count ---
      final surveyQuiz = SanitizedQuiz.fromJson({
        'settings': {'passScore': 0, 'maxAttempts': null},
        'totalPoints': 0,
        'questions': [
          {
            'id': 'q-1',
            'type': 'mcq_single',
            'prompt': 'Pick A',
            'graded': false,
            'options': [
              {'id': 'a', 'text': 'Option A'},
            ],
          },
        ],
      });
      await pumpApp(
        tester,
        QuizPlayer(
          key: const ValueKey('survey'),
          itemId: 'item-1',
          quiz: surveyQuiz,
          attemptsUsed: 0,
          maxAttempts: null,
          onCompleted: (_) {},
        ),
        overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
      );

      expect(find.textContaining('Pass score'), findsNothing);
      expect(find.text('Unlimited attempts'), findsOneWidget);
    },
  );
}
