import React from 'react';
import {render} from '@testing-library/react-native';
import {ArticleQuestionCard} from '@/screens/CourseItemPlayerScreen/components/players/ArticleQuestionCard';

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
  useSubmitArticleQuestionAnswerMutation: jest.fn(() => [jest.fn(), {isLoading: false}]),
}));

const mockQuestion = {
  id: 'q1',
  type: 'mcq_single' as const,
  prompt: 'Plain prompt',
  promptHtml: '<p>Rich prompt</p>',
  points: 1,
  options: [{id: 'o1', text: 'Option 1'}],
  answered: null,
  correctOptionId: null,
  explanation: null,
};

describe('ArticleQuestionCard — Rich Text Support', () => {
  it('renders promptHtml when present', () => {
    const {getByText} = render(
      <ArticleQuestionCard
        itemId="item-1"
        question={mockQuestion}
        onAnswered={jest.fn()}
      />
    );

    expect(getByText('<p>Rich prompt</p>')).toBeTruthy();
  });

  it('falls back to prompt when promptHtml is absent', () => {
    const {getByText} = render(
      <ArticleQuestionCard
        itemId="item-1"
        question={{...mockQuestion, promptHtml: undefined}}
        onAnswered={jest.fn()}
      />
    );

    expect(getByText('Plain prompt')).toBeTruthy();
  });
});
