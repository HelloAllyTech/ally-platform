import { buildQuestionResult } from '../track-quiz.service';
import { isFeedbackHiddenQuiz } from '../../util/track-quiz-grading.util';
import {
  McqSingleQuestion,
  QuizContent,
  QuizQuestionType,
} from '../../type/quiz.type';

const mcq = (
  overrides: Partial<McqSingleQuestion> = {},
): McqSingleQuestion => ({
  id: 'q1',
  type: QuizQuestionType.MCQ_SINGLE,
  prompt: 'Pick one',
  points: 1,
  options: [
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
  ],
  correctOptionIds: ['a'],
  ...overrides,
});

const quiz = (
  passScore: number,
  questions: McqSingleQuestion[],
): Pick<QuizContent, 'settings' | 'questions'> => ({
  settings: { passScore },
  questions,
});

describe('isFeedbackHiddenQuiz', () => {
  it('is true for graded questions that hide the answer, with no pass mark', () => {
    expect(
      isFeedbackHiddenQuiz(quiz(0, [mcq({ showCorrectAnswer: false })])),
    ).toBe(true);
  });

  it('is false when there is a pass mark', () => {
    expect(
      isFeedbackHiddenQuiz(quiz(70, [mcq({ showCorrectAnswer: false })])),
    ).toBe(false);
  });

  it('is false when the answer is shown, or left at its default', () => {
    expect(isFeedbackHiddenQuiz(quiz(0, [mcq()]))).toBe(false);
    expect(
      isFeedbackHiddenQuiz(quiz(0, [mcq({ showCorrectAnswer: true })])),
    ).toBe(false);
  });

  it('is false when any graded question shows its answer', () => {
    expect(
      isFeedbackHiddenQuiz(
        quiz(0, [
          mcq({ showCorrectAnswer: false }),
          mcq({ id: 'q2', showCorrectAnswer: true }),
        ]),
      ),
    ).toBe(false);
  });

  it('is false when nothing is graded', () => {
    expect(
      isFeedbackHiddenQuiz(
        quiz(0, [mcq({ isGraded: false, showCorrectAnswer: false })]),
      ),
    ).toBe(false);
  });

  it('ignores ungraded questions when the graded ones all hide the answer', () => {
    expect(
      isFeedbackHiddenQuiz(
        quiz(0, [
          mcq({ showCorrectAnswer: false }),
          mcq({ id: 'q2', isGraded: false }),
        ]),
      ),
    ).toBe(true);
  });
});

describe('buildQuestionResult - feedbackHidden', () => {
  const entry = {
    questionId: 'q1',
    correct: false,
    graded: true,
    pointsAwarded: 0,
    pointsPossible: 1,
    llm: { score: 0, maxScore: 1, feedback: 'Not quite' },
  } as never;

  it('sends no verdict, points or AI feedback', () => {
    const result = buildQuestionResult(
      entry,
      mcq({ showCorrectAnswer: false, explanation: 'Because' }),
      true,
      true,
    );
    expect(result.correct).toBeNull();
    expect(result.pointsAwarded).toBe(0);
    expect(result).not.toHaveProperty('llmFeedback');
    expect(result).not.toHaveProperty('correctAnswer');
  });

  it('marks the row as not scored, so an older client reads no verdict as "no verdict" and not "pending grading"', () => {
    const result = buildQuestionResult(
      entry,
      mcq({ showCorrectAnswer: false }),
      true,
      true,
    );
    // Older web tabs and the mobile app treat `correct: null` on a graded row
    // as waiting for the AI grader, and park the learner on "Finish grading".
    expect(result.graded).toBe(false);
    expect(result.pointsPossible).toBe(0);
  });

  it('still sends the verdict when feedback is not hidden', () => {
    const result = buildQuestionResult(
      entry,
      mcq({ showCorrectAnswer: false }),
      true,
    );
    expect(result.correct).toBe(false);
    expect(result.llmFeedback).toBe('Not quite');
  });
});
