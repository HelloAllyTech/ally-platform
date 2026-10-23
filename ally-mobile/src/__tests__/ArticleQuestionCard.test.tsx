import React from 'react';
import { render } from '@testing-library/react-native';
import { ArticleQuestionCard } from '@/screens/CourseItemPlayerScreen/components/players/ArticleQuestionCard';
import { ArticleQuestion } from '@/types';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('@/services', () => ({
  useSubmitArticleQuestionAnswerMutation: () => [jest.fn(), { isLoading: false }],
}));

const mockQuestion: ArticleQuestion = {
  id: 'q1',
  prompt: 'Test Question Prompt',
  type: 'mcq_single',
  points: 1,
  options: [
    { id: 'o1', text: 'Option 1' },
    { id: 'o2', text: 'Option 2' },
  ],
  answered: null,
  correctOptionId: null,
  explanation: null,

};

describe('ArticleQuestionCard', () => {
  it('renders correctly', () => {
    const { toJSON } = render(
      <ArticleQuestionCard
        itemId="i1"
        question={mockQuestion}
        onAnswered={jest.fn()}
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });
});
