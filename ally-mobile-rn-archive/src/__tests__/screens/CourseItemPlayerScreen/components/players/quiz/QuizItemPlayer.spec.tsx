import {fireEvent, render} from '@testing-library/react-native';
import {QuizItemPlayer} from '@/screens/CourseItemPlayerScreen/components/players/quiz/QuizItemPlayer';
import {TrackItemType} from '@/types';

jest.mock('@/hooks', () => ({
  useTranslate: jest.fn(() => ({
    t: (key: string) => key,
    tVariable: (key: string) => key,
  })),
}));

jest.mock('@/components', () => {
  const RN = require('react-native');
  return {
    RichText: ({html, testID}: any) => <RN.Text testID={testID || 'rich-text'}>{html}</RN.Text>,
    Button: ({label, onPress, testID}: any) => (
      <RN.TouchableOpacity testID={testID} onPress={onPress}>
        <RN.Text>{label}</RN.Text>
      </RN.TouchableOpacity>
    ),
  };
});

jest.mock('@/services', () => ({
  useSubmitQuizAttemptMutation: jest.fn(() => [jest.fn(), {isLoading: false}]),
  useRegradeQuizAttemptMutation: jest.fn(() => [jest.fn(), {isLoading: false}]),
  useStartTrackItemMutation: jest.fn(() => [jest.fn(), {isLoading: false}]),
}));

const mockPayload = {
  type: TrackItemType.QUIZ as const,
  trackItemProgressId: 'progress-1',
  attemptsUsed: 0,
  maxAttempts: null,
  quiz: {
    settings: {
      passScore: 80,
      maxAttempts: null,
      showExplanations: 'always',
    },
    questions: [
      {
        id: 'q1',
        type: 'mcq_single' as const,
        prompt: 'Plain prompt 1',
        promptHtml: '<p>Rich prompt 1</p>',
        points: 1,
        options: [{id: 'o1', text: 'Option 1'}],
      },
      {
        id: 'q2',
        type: 'mcq_single' as const,
        prompt: 'Fallback prompt 2',
        points: 1,
        options: [{id: 'o2', text: 'Option 2'}],
      },
    ],
    totalPoints: 2,
  },
};

describe('QuizItemPlayer — Rich Text Support', () => {
  it('renders promptHtml when present, and falls back to prompt', () => {
    const {getByText, getByTestId} = render(
      <QuizItemPlayer
        payload={mockPayload}
        itemId="item-1"
        onCompleted={jest.fn()}
        onRequestNext={jest.fn()}
      />
    );

    // Skip intro
    fireEvent.press(getByTestId('quiz-start'));

    // Question 1: has promptHtml
    expect(getByText('<p>Rich prompt 1</p>')).toBeTruthy();

    // Mock that we answered so we can go to next
    // The real McqQuestion will render options
    fireEvent.press(getByText('Option 1'));
    fireEvent.press(getByTestId('quiz-next-question'));

    // Question 2: only prompt (fallback)
    expect(getByText('Fallback prompt 2')).toBeTruthy();
  });
});
