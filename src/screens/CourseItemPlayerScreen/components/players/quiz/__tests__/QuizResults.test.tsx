import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {QuizAttemptResult, SanitizedQuizQuestion} from '@/types';

import {QuizResults} from '../QuizResults';

jest.mock('@/hooks', () => ({
  useTranslate: jest.fn(() => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
    tVariable: (key: string) => key,
  })),
}));

jest.mock('@/components', () => {
  const RN = require('react-native');
  return {
    Button: ({label, onPress, isDisabled, testID}: any) => (
      <RN.TouchableOpacity testID={testID} onPress={onPress} disabled={isDisabled}>
        <RN.Text>{label}</RN.Text>
      </RN.TouchableOpacity>
    ),
    CircularProgress: ({children}: any) => <RN.View>{children}</RN.View>,
  };
});

const questions: SanitizedQuizQuestion[] = [
  {id: 'q1', type: 'true_false', prompt: 'Is this true?', points: 1},
];

const buildResult = (overrides: Partial<QuizAttemptResult> = {}): QuizAttemptResult => ({
  attemptId: 'attempt-1',
  attemptNumber: 1,
  status: 'GRADED',
  scorePct: 100,
  passed: true,
  passScore: 70,
  attemptsUsed: 1,
  maxAttempts: 3,
  questions: [
    {
      questionId: 'q1',
      correct: true,
      pointsAwarded: 1,
      pointsPossible: 1,
      explanation: 'Because it is.',
    },
  ],
  itemCompleted: true,
  unlockedItemIds: [],
  sectionCompleted: false,
  trackCompleted: false,
  ...overrides,
});

describe('QuizResults', () => {
  it('shows Next when passed', () => {
    const onNext = jest.fn();
    const {getByTestId, queryByTestId} = render(
      <QuizResults
        result={buildResult()}
        questions={questions}
        isRegrading={false}
        canRetry={false}
        onRegrade={jest.fn()}
        onRetry={jest.fn()}
        onNext={onNext}
      />,
    );
    expect(queryByTestId('quiz-retry')).toBeNull();
    fireEvent.press(getByTestId('quiz-next'));
    expect(onNext).toHaveBeenCalled();
  });

  it('shows Retry when failed with attempts remaining', () => {
    const onRetry = jest.fn();
    const {getByTestId, queryByTestId} = render(
      <QuizResults
        result={buildResult({
          passed: false,
          questions: [
            {questionId: 'q1', correct: false, pointsAwarded: 0, pointsPossible: 1},
          ],
        })}
        questions={questions}
        isRegrading={false}
        canRetry
        onRegrade={jest.fn()}
        onRetry={onRetry}
        onNext={jest.fn()}
      />,
    );
    expect(queryByTestId('quiz-next')).toBeNull();
    fireEvent.press(getByTestId('quiz-retry'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('shows no retry/next CTA when failed with no attempts remaining', () => {
    const {queryByTestId} = render(
      <QuizResults
        result={buildResult({
          passed: false,
          questions: [
            {questionId: 'q1', correct: false, pointsAwarded: 0, pointsPossible: 1},
          ],
        })}
        questions={questions}
        isRegrading={false}
        canRetry={false}
        onRegrade={jest.fn()}
        onRetry={jest.fn()}
        onNext={jest.fn()}
      />,
    );
    expect(queryByTestId('quiz-retry')).toBeNull();
    expect(queryByTestId('quiz-next')).toBeNull();
  });

  it('shows Finish grading while a question is pending, taking priority over pass/fail', () => {
    const onRegrade = jest.fn();
    const {getByTestId, queryByTestId} = render(
      <QuizResults
        result={buildResult({
          questions: [
            {questionId: 'q1', correct: null, pointsAwarded: 0, pointsPossible: 1},
          ],
        })}
        questions={questions}
        isRegrading={false}
        canRetry={false}
        onRegrade={onRegrade}
        onRetry={jest.fn()}
        onNext={jest.fn()}
      />,
    );
    expect(queryByTestId('quiz-next')).toBeNull();
    fireEvent.press(getByTestId('quiz-finish-grading'));
    expect(onRegrade).toHaveBeenCalled();
  });

  it('expands a question row to reveal its explanation', () => {
    const {getByTestId, getByText, queryByText} = render(
      <QuizResults
        result={buildResult()}
        questions={questions}
        isRegrading={false}
        canRetry={false}
        onRegrade={jest.fn()}
        onRetry={jest.fn()}
        onNext={jest.fn()}
      />,
    );
    expect(queryByText(/Because it is\./)).toBeNull();
    fireEvent.press(getByTestId('question-row-q1'));
    expect(getByText(/Because it is\./)).toBeTruthy();
  });

  it('pending logic ignores an ungraded question with no key (correct: null, graded: false)', () => {
    const {queryByTestId} = render(
      <QuizResults
        result={buildResult({
          questions: [
            {
              questionId: 'q1',
              correct: null,
              graded: false,
              pointsAwarded: 0,
              pointsPossible: 0,
            },
          ],
        })}
        questions={questions}
        isRegrading={false}
        canRetry={false}
        onRegrade={jest.fn()}
        onRetry={jest.fn()}
        onNext={jest.fn()}
      />,
    );
    // Not pending, so the passed result's Next CTA still shows.
    expect(queryByTestId('quiz-finish-grading')).toBeNull();
    expect(queryByTestId('quiz-next')).toBeTruthy();
  });

  it('shows a neutral "Not scored" row for an ungraded question instead of points', () => {
    const {getByText, queryByText} = render(
      <QuizResults
        result={buildResult({
          questions: [
            {
              questionId: 'q1',
              correct: null,
              graded: false,
              pointsAwarded: 0,
              pointsPossible: 0,
            },
          ],
        })}
        questions={questions}
        isRegrading={false}
        canRetry={false}
        onRegrade={jest.fn()}
        onRetry={jest.fn()}
        onNext={jest.fn()}
      />,
    );
    expect(getByText('courses.quiz.results.notScored')).toBeTruthy();
    expect(queryByText('0/0')).toBeNull();
  });

  it('shows the verdict for an ungraded question that still has a key (practice question)', () => {
    const {getByTestId, getByText} = render(
      <QuizResults
        result={buildResult({
          questions: [
            {
              questionId: 'q1',
              correct: false,
              graded: false,
              pointsAwarded: 0,
              pointsPossible: 0,
            },
          ],
        })}
        questions={questions}
        isRegrading={false}
        canRetry={false}
        onRegrade={jest.fn()}
        onRetry={jest.fn()}
        onNext={jest.fn()}
      />,
    );
    fireEvent.press(getByTestId('question-row-q1'));
    expect(getByText('courses.quiz.results.incorrect')).toBeTruthy();
  });

  it('renders "Correct answer:" when correctAnswer is present', () => {
    const {getByTestId, getByText} = render(
      <QuizResults
        result={buildResult({
          questions: [
            {
              questionId: 'q1',
              correct: false,
              pointsAwarded: 0,
              pointsPossible: 1,
              correctAnswer: {booleanAnswer: true},
            },
          ],
        })}
        questions={questions}
        isRegrading={false}
        canRetry={false}
        onRegrade={jest.fn()}
        onRetry={jest.fn()}
        onNext={jest.fn()}
      />,
    );
    fireEvent.press(getByTestId('question-row-q1'));
    expect(
      getByText(
        /courses\.quiz\.results\.correctAnswer:\s*courses\.quiz\.question\.true/,
      ),
    ).toBeTruthy();
  });

  it('shows only the verdict, not a hidden notice, when correctAnswer is absent on a graded question', () => {
    const {getByTestId, queryByText, getByText} = render(
      <QuizResults
        result={buildResult({
          questions: [
            {questionId: 'q1', correct: false, pointsAwarded: 0, pointsPossible: 1},
          ],
        })}
        questions={questions}
        isRegrading={false}
        canRetry={false}
        onRegrade={jest.fn()}
        onRetry={jest.fn()}
        onNext={jest.fn()}
      />,
    );
    fireEvent.press(getByTestId('question-row-q1'));
    expect(getByText('courses.quiz.results.incorrect')).toBeTruthy();
    expect(queryByText(/correctAnswer/)).toBeNull();
  });

  it('replaces the score ring and pass/fail badge with "Responses submitted" for a survey (scorePct null)', () => {
    const {getByText, queryByText, getByTestId} = render(
      <QuizResults
        result={buildResult({
          scorePct: null,
          questions: [
            {
              questionId: 'q1',
              correct: null,
              graded: false,
              pointsAwarded: 0,
              pointsPossible: 0,
            },
          ],
        })}
        questions={questions}
        isRegrading={false}
        canRetry={false}
        onRegrade={jest.fn()}
        onRetry={jest.fn()}
        onNext={jest.fn()}
      />,
    );
    expect(getByText('courses.quiz.results.responsesSubmitted')).toBeTruthy();
    expect(queryByText('courses.quiz.results.passed')).toBeNull();
    expect(queryByText('courses.quiz.results.failed')).toBeNull();
    expect(queryByText('100%')).toBeNull();
    expect(getByTestId('quiz-next')).toBeTruthy();
  });

  it('shows a likert question\'s "Your responses" list instead of a verdict', () => {
    const likertQuestions: SanitizedQuizQuestion[] = [
      {
        id: 'q1',
        type: 'likert_scale',
        prompt: 'Rate these',
        points: 0,
        graded: false,
        statements: [{id: 's1', text: 'I feel confident'}],
        scale: [
          {id: 'sc1', text: 'Disagree'},
          {id: 'sc2', text: 'Agree'},
        ],
      },
    ];
    const {getByTestId, getByText, queryByText} = render(
      <QuizResults
        result={buildResult({
          scorePct: null,
          questions: [
            {
              questionId: 'q1',
              correct: null,
              graded: false,
              pointsAwarded: 0,
              pointsPossible: 0,
            },
          ],
        })}
        questions={likertQuestions}
        answers={{q1: {ratings: {s1: 'sc2'}}}}
        isRegrading={false}
        canRetry={false}
        onRegrade={jest.fn()}
        onRetry={jest.fn()}
        onNext={jest.fn()}
      />,
    );
    fireEvent.press(getByTestId('question-row-q1'));
    expect(getByText('courses.quiz.results.yourResponses')).toBeTruthy();
    expect(getByText('I feel confident')).toBeTruthy();
    expect(getByText('Agree')).toBeTruthy();
    expect(queryByText('courses.quiz.results.incorrect')).toBeNull();
  });
});
