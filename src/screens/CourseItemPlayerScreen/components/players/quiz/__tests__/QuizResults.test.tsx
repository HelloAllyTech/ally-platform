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
});
