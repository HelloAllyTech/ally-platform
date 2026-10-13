import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/courses/data/quiz_models.dart';

void main() {
  group('quizQuestionTypeFromString', () {
    test('maps every known backend string', () {
      expect(quizQuestionTypeFromString('mcq_single'), QuizQuestionType.mcqSingle);
      expect(quizQuestionTypeFromString('mcq_multi'), QuizQuestionType.mcqMulti);
      expect(quizQuestionTypeFromString('true_false'), QuizQuestionType.trueFalse);
      expect(quizQuestionTypeFromString('ordering'), QuizQuestionType.ordering);
      expect(quizQuestionTypeFromString('matching'), QuizQuestionType.matching);
      expect(quizQuestionTypeFromString('fill_blank'), QuizQuestionType.fillBlank);
      expect(quizQuestionTypeFromString('open_ended'), QuizQuestionType.openEnded);
      expect(quizQuestionTypeFromString('likert_scale'), QuizQuestionType.likertScale);
    });

    test('falls back to unknown for an unrecognized or null string', () {
      expect(quizQuestionTypeFromString('something_new'), QuizQuestionType.unknown);
      expect(quizQuestionTypeFromString(null), QuizQuestionType.unknown);
    });
  });

  group('QuizOption.fromJson', () {
    test('parses id and text', () {
      final option = QuizOption.fromJson({'id': 'opt-1', 'text': 'Yes'});
      expect(option.id, 'opt-1');
      expect(option.text, 'Yes');
    });
  });

  group('SanitizedQuizQuestion.fromJson', () {
    test('parses an mcq_single question with options', () {
      final q = SanitizedQuizQuestion.fromJson({
        'id': 'q-1',
        'type': 'mcq_single',
        'prompt': 'Pick one',
        'points': 5,
        'graded': true,
        'options': [
          {'id': 'a', 'text': 'Option A'},
          {'id': 'b', 'text': 'Option B'},
        ],
      });

      expect(q.id, 'q-1');
      expect(q.type, QuizQuestionType.mcqSingle);
      expect(q.prompt, 'Pick one');
      expect(q.points, 5);
      expect(q.graded, true);
      expect(q.options, hasLength(2));
      expect(q.options![0].id, 'a');
      expect(q.items, isNull);
      expect(q.left, isNull);
      expect(q.right, isNull);
      expect(q.template, isNull);
      expect(q.blankIds, isNull);
      expect(q.minWords, isNull);
      expect(q.statements, isNull);
      expect(q.scale, isNull);
    });

    test('parses an ordering question with items', () {
      final q = SanitizedQuizQuestion.fromJson({
        'id': 'q-2',
        'type': 'ordering',
        'prompt': 'Order these',
        'items': [
          {'id': 'i1', 'text': 'First'},
          {'id': 'i2', 'text': 'Second'},
        ],
      });

      expect(q.type, QuizQuestionType.ordering);
      expect(q.items, hasLength(2));
      expect(q.items![1].text, 'Second');
    });

    test('parses a matching question with left/right', () {
      final q = SanitizedQuizQuestion.fromJson({
        'id': 'q-3',
        'type': 'matching',
        'prompt': 'Match these',
        'left': [
          {'id': 'l1', 'text': 'Left one'},
        ],
        'right': [
          {'id': 'r1', 'text': 'Right one'},
        ],
      });

      expect(q.type, QuizQuestionType.matching);
      expect(q.left, hasLength(1));
      expect(q.right, hasLength(1));
      expect(q.left![0].id, 'l1');
      expect(q.right![0].id, 'r1');
    });

    test('parses a fill_blank question with template and blankIds', () {
      final q = SanitizedQuizQuestion.fromJson({
        'id': 'q-4',
        'type': 'fill_blank',
        'prompt': 'Fill it in',
        'template': 'The sky is {{b1}}.',
        'blankIds': ['b1'],
      });

      expect(q.type, QuizQuestionType.fillBlank);
      expect(q.template, 'The sky is {{b1}}.');
      expect(q.blankIds, ['b1']);
    });

    test('parses an open_ended question with minWords', () {
      final q = SanitizedQuizQuestion.fromJson({
        'id': 'q-5',
        'type': 'open_ended',
        'prompt': 'Describe your feelings',
        'minWords': 20,
      });

      expect(q.type, QuizQuestionType.openEnded);
      expect(q.minWords, 20);
    });

    test('parses a likert_scale question with statements and scale', () {
      final q = SanitizedQuizQuestion.fromJson({
        'id': 'q-6',
        'type': 'likert_scale',
        'prompt': 'Rate these',
        'graded': false,
        'statements': [
          {'id': 's1', 'text': 'I feel calm'},
        ],
        'scale': [
          {'id': 'sc1', 'text': 'Strongly disagree'},
          {'id': 'sc5', 'text': 'Strongly agree'},
        ],
      });

      expect(q.type, QuizQuestionType.likertScale);
      expect(q.graded, false);
      expect(q.statements, hasLength(1));
      expect(q.scale, hasLength(2));
    });

    test('parses a true_false question', () {
      final q = SanitizedQuizQuestion.fromJson({
        'id': 'q-7',
        'type': 'true_false',
        'prompt': 'Is this true?',
      });

      expect(q.type, QuizQuestionType.trueFalse);
    });

    test('falls back to unknown type for an unrecognized string', () {
      final q = SanitizedQuizQuestion.fromJson({
        'id': 'q-8',
        'type': 'something_weird',
        'prompt': 'Mystery question',
      });

      expect(q.type, QuizQuestionType.unknown);
    });

    test('defaults points to 0 and graded to true when missing', () {
      final q = SanitizedQuizQuestion.fromJson({
        'id': 'q-9',
        'type': 'mcq_single',
        'prompt': 'No points specified',
      });

      expect(q.points, 0);
      expect(q.graded, true);
    });
  });

  group('SanitizedQuiz.fromJson', () {
    test('parses settings and questions', () {
      final quiz = SanitizedQuiz.fromJson({
        'settings': {'passScore': 70, 'maxAttempts': 3},
        'totalPoints': 10,
        'questions': [
          {
            'id': 'q-1',
            'type': 'mcq_single',
            'prompt': 'Pick one',
            'options': [
              {'id': 'a', 'text': 'A'},
            ],
          },
        ],
      });

      expect(quiz.passScore, 70);
      expect(quiz.maxAttempts, 3);
      expect(quiz.totalPoints, 10);
      expect(quiz.questions, hasLength(1));
      expect(quiz.questions[0].id, 'q-1');
    });

    test('maxAttempts is null when absent (unlimited attempts)', () {
      final quiz = SanitizedQuiz.fromJson({
        'settings': {'passScore': 50},
        'totalPoints': 5,
        'questions': <dynamic>[],
      });

      expect(quiz.maxAttempts, isNull);
      expect(quiz.questions, isEmpty);
    });
  });

  group('QuizAnswerInput.toJson', () {
    test('only emits the fields that were set (mcq)', () {
      final answer = QuizAnswerInput(questionId: 'q-1', selectedOptionIds: ['a', 'b']);
      expect(answer.toJson(), {
        'questionId': 'q-1',
        'selectedOptionIds': ['a', 'b'],
      });
    });

    test('emits booleanAnswer for true_false', () {
      final answer = QuizAnswerInput(questionId: 'q-2', booleanAnswer: false);
      expect(answer.toJson(), {'questionId': 'q-2', 'booleanAnswer': false});
    });

    test('emits orderedItemIds for ordering', () {
      final answer = QuizAnswerInput(questionId: 'q-3', orderedItemIds: ['i2', 'i1']);
      expect(answer.toJson(), {
        'questionId': 'q-3',
        'orderedItemIds': ['i2', 'i1'],
      });
    });

    test('emits pairs for matching', () {
      final answer = QuizAnswerInput(
        questionId: 'q-4',
        pairs: [(leftId: 'l1', rightId: 'r1')],
      );
      expect(answer.toJson(), {
        'questionId': 'q-4',
        'pairs': [
          {'leftId': 'l1', 'rightId': 'r1'},
        ],
      });
    });

    test('emits blanks for fill_blank', () {
      final answer = QuizAnswerInput(
        questionId: 'q-5',
        blanks: [(blankId: 'b1', answer: 'blue')],
      );
      expect(answer.toJson(), {
        'questionId': 'q-5',
        'blanks': [
          {'blankId': 'b1', 'answer': 'blue'},
        ],
      });
    });

    test('emits text for open_ended', () {
      final answer = QuizAnswerInput(questionId: 'q-6', text: 'My answer');
      expect(answer.toJson(), {'questionId': 'q-6', 'text': 'My answer'});
    });

    test('emits ratings for likert_scale', () {
      final answer = QuizAnswerInput(
        questionId: 'q-7',
        ratings: [(statementId: 's1', scaleOptionId: 'sc3')],
      );
      expect(answer.toJson(), {
        'questionId': 'q-7',
        'ratings': [
          {'statementId': 's1', 'scaleOptionId': 'sc3'},
        ],
      });
    });

    test('emits only questionId when nothing else is set', () {
      final answer = QuizAnswerInput(questionId: 'q-8');
      expect(answer.toJson(), {'questionId': 'q-8'});
    });
  });

  group('QuizQuestionResult.fromJson', () {
    test('parses every field', () {
      final result = QuizQuestionResult.fromJson({
        'questionId': 'q-1',
        'correct': true,
        'pointsAwarded': 5,
        'pointsPossible': 5,
        'explanation': 'Well done',
      });

      expect(result.questionId, 'q-1');
      expect(result.correct, true);
      expect(result.pointsAwarded, 5);
      expect(result.pointsPossible, 5);
      expect(result.explanation, 'Well done');
    });

    test('correct is null for pending-grading (open_ended) questions', () {
      final result = QuizQuestionResult.fromJson({
        'questionId': 'q-2',
        'pointsAwarded': 0,
        'pointsPossible': 10,
      });

      expect(result.correct, isNull);
      expect(result.pointsAwarded, 0);
      expect(result.pointsPossible, 10);
      expect(result.explanation, isNull);
    });

    test('defaults pointsAwarded/pointsPossible to 0 when missing', () {
      final result = QuizQuestionResult.fromJson({'questionId': 'q-3'});
      expect(result.pointsAwarded, 0);
      expect(result.pointsPossible, 0);
    });
  });

  group('QuizAttemptResult.fromJson', () {
    test('parses every field including nested questionResults', () {
      final result = QuizAttemptResult.fromJson({
        'attemptId': 'attempt-1',
        'scorePct': 80.0,
        'passed': true,
        'passScore': 70,
        'attemptsUsed': 1,
        'maxAttempts': 3,
        'questionResults': [
          {
            'questionId': 'q-1',
            'correct': true,
            'pointsAwarded': 5,
            'pointsPossible': 5,
          },
        ],
      });

      expect(result.attemptId, 'attempt-1');
      expect(result.scorePct, 80.0);
      expect(result.passed, true);
      expect(result.passScore, 70);
      expect(result.attemptsUsed, 1);
      expect(result.maxAttempts, 3);
      expect(result.questionResults, hasLength(1));
    });

    test('maxAttempts and scorePct are null, questionResults defaults to empty', () {
      final result = QuizAttemptResult.fromJson({
        'attemptId': 'attempt-2',
        'passed': false,
        'passScore': 70,
        'attemptsUsed': 2,
      });

      expect(result.maxAttempts, isNull);
      expect(result.scorePct, isNull);
      expect(result.questionResults, isEmpty);
    });
  });
}
