import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/courses/data/course_models.dart';
import 'package:ally_mobile_flutter/features/courses/data/courses_repository.dart';
import 'package:ally_mobile_flutter/features/courses/data/quiz_models.dart';
import 'package:ally_mobile_flutter/features/courses/data/start_item_payload.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/quiz/quiz_player.dart';

import '../../../../support/pump_app.dart';

class MockCoursesRepository extends Mock implements CoursesRepository {}

Map<String, dynamic> _quizJson() => {
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
      'type': 'true_false',
      'prompt': 'Sky is green',
    },
  ],
};

Map<String, dynamic> _attempt({
  required bool passed,
  String status = 'GRADED',
  int attemptsUsed = 1,
  double? scorePct,
  List<Map<String, dynamic>>? questions,
}) => {
  'attemptId': 'attempt-1',
  'status': status,
  'scorePct': scorePct ?? (passed ? 100.0 : 50.0),
  'passed': passed,
  'passScore': 70,
  'attemptsUsed': attemptsUsed,
  'maxAttempts': 3,
  'itemCompleted': passed,
  'sectionCompleted': false,
  'trackCompleted': false,
  'questions':
      questions ??
      [
        {'questionId': 'q-1', 'correct': true, 'graded': true, 'pointsAwarded': 5, 'pointsPossible': 5},
        {
          'questionId': 'q-2',
          'correct': passed,
          'graded': true,
          'pointsAwarded': passed ? 5 : 0,
          'pointsPossible': 5,
          'explanation': 'Skies are blue.',
          'correctAnswer': {'booleanAnswer': false},
          'llmFeedback': 'Close, but no.',
        },
      ],
};

void main() {
  setUpAll(() {
    registerFallbackValue(<QuizAnswerInput>[]);
  });

  // One testWidgets (see pump_app.dart: translations resolve only in the
  // first pump of a file); each scenario re-pumps with a fresh key.
  testWidgets('QuizPlayer pages questions, submits, shows results, regrades and retries like RN', (tester) async {
    final repository = MockCoursesRepository();
    final quiz = SanitizedQuiz.fromJson(_quizJson());
    TrackItemCompletionResult? completion;
    var nextRequested = false;

    Future<void> pumpQuiz(Key key, {int attemptsUsed = 0}) => pumpApp(
      tester,
      Scaffold(
        body: QuizPlayer(
          key: key,
          itemId: 'item-1',
          quiz: quiz,
          attemptsUsed: attemptsUsed,
          maxAttempts: 3,
          onCompleted: (r) => completion = r,
          onRequestNext: () => nextRequested = true,
        ),
      ),
      overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
    );

    Future<void> answerAll() async {
      await tester.tap(find.byKey(const Key('quiz-start')));
      await tester.pumpAndSettle();
      expect(find.text('Question 1 of 2'), findsOneWidget);
      // Next is gated on answering the current question.
      await tester.tap(find.byKey(const Key('quiz-next-question')));
      await tester.pumpAndSettle();
      expect(find.text('Question 1 of 2'), findsOneWidget);
      await tester.tap(find.byKey(const Key('mcq-option-a')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('quiz-next-question')));
      await tester.pumpAndSettle();
      expect(find.text('Question 2 of 2'), findsOneWidget);
      expect(find.text('Sky is green'), findsOneWidget);
      await tester.tap(find.byKey(const Key('true-false-true')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('quiz-submit')));
      await tester.pumpAndSettle();
    }

    // --- intro ---
    await pumpQuiz(const ValueKey('intro'));
    expect(find.text('2 questions'), findsOneWidget);
    expect(find.text('Pass score: 70%'), findsOneWidget);
    expect(find.text('3 attempts left'), findsOneWidget);

    // --- failed attempt: correct answer, explanation, AI feedback, Retry ---
    when(() => repository.submitQuizAttempt(itemId: 'item-1', answers: any(named: 'answers')))
        .thenAnswer((_) async => QuizAttemptResult.fromJson(_attempt(passed: false)));
    await answerAll();
    expect(find.text('50%'), findsOneWidget);
    expect(find.text('Failed'), findsOneWidget);
    expect(find.text('Attempt 1 of 3'), findsOneWidget);
    await tester.tap(find.byKey(const Key('question-row-q-2')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Correct answer'), findsOneWidget);
    expect(find.textContaining('Skies are blue.'), findsOneWidget);
    expect(find.byKey(const Key('quiz-ai-feedback')), findsOneWidget);
    expect(completion, isNull);

    // Retry re-starts the item for a fresh quiz.
    when(() => repository.startTrackItem('item-1')).thenAnswer(
      (_) async => StartItemPayload.fromJson({
        'trackItemProgressId': 'p',
        'type': 'QUIZ',
        'quiz': _quizJson(),
        'attemptsUsed': 1,
        'maxAttempts': 3,
      }),
    );
    await tester.tap(find.byKey(const Key('quiz-retry')));
    await tester.pumpAndSettle();
    verify(() => repository.startTrackItem('item-1')).called(1);
    expect(find.text('Question 1 of 2'), findsOneWidget);

    // --- pending grading: Finish grading regrades, then passes ---
    when(() => repository.submitQuizAttempt(itemId: 'item-1', answers: any(named: 'answers'))).thenAnswer(
      (_) async => QuizAttemptResult.fromJson(
        _attempt(
          passed: false,
          status: 'PENDING_GRADING',
          questions: [
            {'questionId': 'q-1', 'correct': null, 'graded': true, 'pointsAwarded': 0, 'pointsPossible': 5},
          ],
        ),
      ),
    );
    when(() => repository.regradeQuizAttempt(itemId: 'item-1', attemptId: 'attempt-1'))
        .thenAnswer((_) async => QuizAttemptResult.fromJson(_attempt(passed: true, attemptsUsed: 2)));
    await pumpQuiz(const ValueKey('pending'));
    await answerAll();
    expect(find.byKey(const Key('quiz-finish-grading')), findsOneWidget);
    expect(find.byKey(const Key('quiz-retry')), findsNothing);
    await tester.tap(find.byKey(const Key('quiz-finish-grading')));
    await tester.pump();
    await tester.pump(const Duration(seconds: 3));
    await tester.pumpAndSettle();
    verify(() => repository.regradeQuizAttempt(itemId: 'item-1', attemptId: 'attempt-1')).called(1);
    expect(find.text('Passed'), findsOneWidget);
    expect(completion?.completed, isTrue);
    await tester.tap(find.byKey(const Key('quiz-next')));
    expect(nextRequested, isTrue);

    // --- survey: no score ring, "Responses submitted", Next ---
    when(() => repository.submitQuizAttempt(itemId: 'item-1', answers: any(named: 'answers'))).thenAnswer(
      (_) async => QuizAttemptResult.fromJson({
        ..._attempt(passed: true),
        'scorePct': null,
        'questions': [
          {'questionId': 'q-1', 'correct': null, 'graded': false, 'pointsAwarded': 0, 'pointsPossible': 0},
        ],
      }),
    );
    await pumpQuiz(const ValueKey('survey'));
    await answerAll();
    await tester.pump(const Duration(seconds: 3));
    await tester.pumpAndSettle();
    expect(find.text('Responses submitted'), findsOneWidget);
    expect(find.byKey(const Key('quiz-score-ring')), findsNothing);
    expect(find.byKey(const Key('quiz-next')), findsOneWidget);

    // --- attempts exhausted: Start disabled ---
    await pumpQuiz(const ValueKey('exhausted'), attemptsUsed: 3);
    expect(find.text('No attempts remaining'), findsOneWidget);
    await tester.tap(find.byKey(const Key('quiz-start')));
    await tester.pumpAndSettle();
    expect(find.text('Question 1 of 2'), findsNothing);
  });

  test('formatQuizCorrectAnswer resolves ids to the text the learner saw', () {
    final q = SanitizedQuizQuestion.fromJson({
      'id': 'q',
      'type': 'ordering',
      'prompt': 'Order',
      'items': [
        {'id': 'x', 'text': 'X'},
        {'id': 'y', 'text': 'Y'},
      ],
    });
    expect(formatQuizCorrectAnswer(q, QuizCorrectAnswer(orderedItemIds: ['y', 'gone', 'x']), (k) => k), 'Y → X');
  });
}
