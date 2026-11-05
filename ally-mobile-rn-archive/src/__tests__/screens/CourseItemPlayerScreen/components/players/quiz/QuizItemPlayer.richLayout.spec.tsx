import {render, fireEvent} from '@testing-library/react-native';
import {StyleSheet} from 'react-native';
import {RichText} from '@/components';
import {QuizItemPlayer} from '@/screens/CourseItemPlayerScreen/components/players/quiz/QuizItemPlayer';
import {TrackItemType} from '@/types';

jest.mock('@/hooks', () => ({
  useTranslate: jest.fn(() => ({
    t: (key: string) => key,
    tVariable: (key: string) => key,
  })),
}));

jest.mock('@/services', () => ({
  useSubmitQuizAttemptMutation: jest.fn(() => [jest.fn(), {isLoading: false}]),
  useRegradeQuizAttemptMutation: jest.fn(() => [jest.fn(), {isLoading: false}]),
  useStartTrackItemMutation: jest.fn(() => [jest.fn(), {isLoading: false}]),
}));

// The global setup stubs '@/components' without RichText. This test needs the
// real RichText inside the real player, which is where a doubled margin shows.
jest.mock('@/components', () => {
  const RN = require('react-native');
  return {
    // Resolved at render: RichText's own imports loop back through this mock.
    RichText: (props: any) => {
      const Real = jest.requireActual('@/components/RichText').RichText;
      return <Real {...props} />;
    },
    Button: ({label, onPress}: any) => (
      <RN.TouchableOpacity testID="primary-button" onPress={onPress}>
        <RN.Text>{label}</RN.Text>
      </RN.TouchableOpacity>
    ),
  };
});
const HTML = '<p>First <strong>para</strong></p><p>Second</p><ul><li>One</li><li>Two</li></ul>';

const payload = {
  type: TrackItemType.QUIZ as const,
  trackItemProgressId: 'progress-1',
  attemptsUsed: 0,
  maxAttempts: null,
  quiz: {
    settings: {passScore: 80, maxAttempts: null, showExplanations: 'always'},
    questions: [
      {
        id: 'q1',
        type: 'mcq_single' as const,
        prompt: 'First para Second One Two',
        promptHtml: HTML,
        points: 1,
        options: [{id: 'o1', text: 'Option 1'}],
      },
    ],
    totalPoints: 1,
  },
};

const marginsOf = (nodes: any[]) =>
  nodes.map(n => StyleSheet.flatten(n.props.style)?.marginBottom);

describe('QuizItemPlayer rich prompt spacing', () => {
  it('keeps RichText’s own paragraph and list spacing instead of the prompt margin', () => {
    const baseline = render(<RichText html={HTML} />);
    const baselineMargins = marginsOf(
      baseline.UNSAFE_getAllByType(require('react-native').Text),
    );

    const {getByTestId, UNSAFE_getAllByType} = render(
      <QuizItemPlayer
        payload={payload as any}
        itemId="item-1"
        onCompleted={jest.fn()}
        onRequestNext={jest.fn()}
      />,
    );
    fireEvent.press(getByTestId('primary-button'));

    const texts = UNSAFE_getAllByType(require('react-native').Text);
    const textOf = (node: any): string =>
      [node.props.children]
        .flat(Infinity)
        .map(c => (typeof c === 'string' ? c : c?.props ? textOf(c) : ''))
        .join('');
    const promptTexts = texts.filter(n =>
      ['First', 'Second', 'One', 'Two'].some(w => textOf(n).includes(w)),
    );
    const margins = marginsOf(promptTexts);

    // Same per-text margins as an unstyled RichText: nothing was inflated.
    baselineMargins
      .filter(m => m !== undefined)
      .forEach(m => expect(margins).toContain(m));
    expect(Math.max(...margins.filter(Boolean))).toBeLessThanOrEqual(
      Math.max(...baselineMargins.filter(Boolean)),
    );
  });
});
