import React from 'react';
import {render} from '@testing-library/react-native';
import {VideoInterjectionModal} from '@/screens/CourseItemPlayerScreen/components/players/VideoInterjectionModal';

jest.mock('@/hooks', () => ({
  useTranslate: jest.fn(() => ({
    t: (key: string) => key,
  })),
}));

jest.mock('@/components', () => {
  const RN = require('react-native');
  return {
    RichText: ({html}: any) => <RN.Text testID="rich-text">{html}</RN.Text>,
    Button: ({label}: any) => <RN.Text>{label}</RN.Text>,
  };
});

jest.mock('@/services', () => ({
  useSubmitInterjectionAnswerMutation: jest.fn(() => [jest.fn(), {isLoading: false}]),
}));

const mockInterjection = {
  id: 'i1',
  timestampSeconds: 10,
  question: {
    id: 'q1',
    type: 'mcq_single' as const,
    prompt: 'Plain prompt',
    promptHtml: '<p>Rich prompt</p>',
    points: 1,
    options: [{id: 'o1', text: 'Option 1'}],
  },
};

describe('VideoInterjectionModal — Rich Text Support', () => {
  it('renders promptHtml when present', () => {
    const {getByText} = render(
      <VideoInterjectionModal
        interjection={mockInterjection}
        itemId="item-1"
        onAnswered={jest.fn()}
        onContinue={jest.fn()}
      />
    );

    expect(getByText('<p>Rich prompt</p>')).toBeTruthy();
  });

  it('falls back to prompt when promptHtml is absent', () => {
    const {getByText} = render(
      <VideoInterjectionModal
        interjection={{
          ...mockInterjection,
          question: {...mockInterjection.question, promptHtml: undefined},
        }}
        itemId="item-1"
        onAnswered={jest.fn()}
        onContinue={jest.fn()}
      />
    );

    expect(getByText('Plain prompt')).toBeTruthy();
  });
});
