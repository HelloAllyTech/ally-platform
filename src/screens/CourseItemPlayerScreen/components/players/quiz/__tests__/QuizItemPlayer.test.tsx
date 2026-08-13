import React from 'react';
import {fireEvent, render, waitFor} from '@testing-library/react-native';

import {StartQuizItemPayload, TrackItemType} from '@/types';

import {QuizItemPlayer} from '../QuizItemPlayer';

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

jest.mock('react-native-confetti-cannon', () => ({
  __esModule: true,
  default: () => null,
}));

const mockSubmitQuizAttempt = jest.fn();
const mockRegradeQuizAttempt = jest.fn();
const mockStartTrackItem = jest.fn();

jest.mock('@/services', () => ({
  useSubmitQuizAttemptMutation: jest.fn(() => [mockSubmitQuizAttempt, {isLoading: false}]),
  useRegradeQuizAttemptMutation: jest.fn(() => [mockRegradeQuizAttempt, {isLoading: false}]),
  useStartTrackItemMutation: jest.fn(() => [mockStartTrackItem]),
}));

const buildPayload = (): StartQuizItemPayload => ({
  type: TrackItemType.QUIZ,
  trackItemProgressId: 'progress-1',
  attemptsUsed: 0,
  maxAttempts: 3,
  quiz: {
    settings: {passScore: 70, maxAttempts: 3, showExplanations: 'always'},
    totalPoints: 1,
    questions: [
      {id: 'q1', type: 'true_false', prompt: 'Is this true?', points: 1},
    ],
  },
});

const passingAttempt = {
  attemptId: 'attempt-1',
  attemptNumber: 1,
  status: 'GRADED' as const,
  scorePct: 100,
  passed: true,
  passScore: 70,
  attemptsUsed: 1,
  maxAttempts: 3,
  questions: [
    {questionId: 'q1', correct: true, pointsAwarded: 1, pointsPossible: 1},
  ],
  itemCompleted: true,
  unlockedItemIds: ['item-2'],
  sectionCompleted: false,
  trackCompleted: false,
};

describe('QuizItemPlayer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSubmitQuizAttempt.mockReturnValue({
      unwrap: jest.fn().mockResolvedValue(passingAttempt),
    });
  });

  it('shows the intro first, and Start moves to the first question', async () => {
    const {getByTestId, queryByTestId} = render(
      <QuizItemPlayer
        payload={buildPayload()}
        itemId="item-1"
        onCompleted={jest.fn()}
        onRequestNext={jest.fn()}
      />,
    );

    expect(getByTestId('quiz-start')).toBeTruthy();
    fireEvent.press(getByTestId('quiz-start'));

    await waitFor(() => expect(queryByTestId('true-false-true')).toBeTruthy());
  });

  it('Submit is disabled until the question is answered, then submits and calls onCompleted on a passing attempt', async () => {
    const onCompleted = jest.fn();
    const {getByTestId} = render(
      <QuizItemPlayer
        payload={buildPayload()}
        itemId="item-1"
        onCompleted={onCompleted}
        onRequestNext={jest.fn()}
      />,
    );

    fireEvent.press(getByTestId('quiz-start'));
    await waitFor(() => expect(getByTestId('true-false-true')).toBeTruthy());

    fireEvent.press(getByTestId('quiz-submit'));
    expect(mockSubmitQuizAttempt).not.toHaveBeenCalled();

    fireEvent.press(getByTestId('true-false-true'));
    fireEvent.press(getByTestId('quiz-submit'));

    await waitFor(() =>
      expect(mockSubmitQuizAttempt).toHaveBeenCalledWith({
        itemId: 'item-1',
        answers: [{questionId: 'q1', booleanAnswer: true}],
      }),
    );
    await waitFor(() =>
      expect(onCompleted).toHaveBeenCalledWith({
        completed: true,
        unlockedItemIds: ['item-2'],
        sectionCompleted: false,
        trackCompleted: false,
      }),
    );
    await waitFor(() => expect(getByTestId('quiz-next')).toBeTruthy());
  });

  it('retrying after a failed attempt re-fetches a fresh (reshuffled) question set', async () => {
    mockSubmitQuizAttempt.mockReturnValue({
      unwrap: jest.fn().mockResolvedValue({
        ...passingAttempt,
        passed: false,
        itemCompleted: false,
        questions: [
          {questionId: 'q1', correct: false, pointsAwarded: 0, pointsPossible: 1},
        ],
      }),
    });
    const freshPayload = buildPayload();
    mockStartTrackItem.mockReturnValue({
      unwrap: jest.fn().mockResolvedValue(freshPayload),
    });

    const {getByTestId} = render(
      <QuizItemPlayer
        payload={buildPayload()}
        itemId="item-1"
        onCompleted={jest.fn()}
        onRequestNext={jest.fn()}
      />,
    );

    fireEvent.press(getByTestId('quiz-start'));
    await waitFor(() => expect(getByTestId('true-false-true')).toBeTruthy());
    fireEvent.press(getByTestId('true-false-true'));
    fireEvent.press(getByTestId('quiz-submit'));

    await waitFor(() => expect(getByTestId('quiz-retry')).toBeTruthy());
    fireEvent.press(getByTestId('quiz-retry'));

    await waitFor(() => expect(mockStartTrackItem).toHaveBeenCalledWith({itemId: 'item-1'}));
    await waitFor(() => expect(getByTestId('true-false-true')).toBeTruthy());
  });
});
