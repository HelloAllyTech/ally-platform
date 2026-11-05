import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {SanitizedQuizQuestion} from '@/types';

import {OpenEndedQuestion} from '../OpenEndedQuestion';

jest.mock('@/hooks', () => ({
  useTranslate: jest.fn(() => ({
    t: (key: string) => key,
    tVariable: (key: string, params?: Record<string, unknown>) =>
      `${key}:${JSON.stringify(params)}`,
  })),
}));

const question: SanitizedQuizQuestion = {
  id: 'q1',
  type: 'open_ended',
  prompt: 'Explain',
  points: 1,
  minWords: 3,
};

describe('OpenEndedQuestion', () => {
  it('calls onChange with the typed text', () => {
    const onChange = jest.fn();
    const {getByTestId} = render(
      <OpenEndedQuestion question={question} state={{text: ''}} onChange={onChange} />,
    );

    fireEvent.changeText(getByTestId('open-ended-input'), 'my answer here');
    expect(onChange).toHaveBeenCalledWith({text: 'my answer here'});
  });

  it('shows the word count against the minimum', () => {
    const {getByText} = render(
      <OpenEndedQuestion
        question={question}
        state={{text: 'one two'}}
        onChange={jest.fn()}
      />,
    );
    expect(
      getByText('courses.quiz.question.wordCount:{"count":2,"min":3}'),
    ).toBeTruthy();
  });
});
