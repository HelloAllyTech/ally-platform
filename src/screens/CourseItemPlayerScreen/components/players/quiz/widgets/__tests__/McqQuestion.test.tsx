import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {SanitizedQuizQuestion} from '@/types';

import {McqQuestion} from '../McqQuestion';

jest.mock('@/hooks', () => ({
  useTranslate: jest.fn(() => ({
    t: (key: string) => key,
    tVariable: (key: string) => key,
  })),
}));

const buildQuestion = (type: 'mcq_single' | 'mcq_multi'): SanitizedQuizQuestion => ({
  id: 'q1',
  type,
  prompt: 'Pick one',
  points: 1,
  options: [
    {id: 'a', text: 'Option A'},
    {id: 'b', text: 'Option B'},
  ],
});

describe('McqQuestion', () => {
  it('mcq_single: selecting a new option replaces the selection', () => {
    const onChange = jest.fn();
    const {getByTestId} = render(
      <McqQuestion
        question={buildQuestion('mcq_single')}
        state={{selectedOptionIds: ['a']}}
        onChange={onChange}
      />,
    );

    fireEvent.press(getByTestId('mcq-option-b'));
    expect(onChange).toHaveBeenCalledWith({selectedOptionIds: ['b']});
  });

  it('mcq_multi: selecting toggles membership without clearing prior selections', () => {
    const onChange = jest.fn();
    const {getByTestId} = render(
      <McqQuestion
        question={buildQuestion('mcq_multi')}
        state={{selectedOptionIds: ['a']}}
        onChange={onChange}
      />,
    );

    fireEvent.press(getByTestId('mcq-option-b'));
    expect(onChange).toHaveBeenCalledWith({selectedOptionIds: ['a', 'b']});
  });

  it('mcq_multi: pressing an already-selected option deselects it', () => {
    const onChange = jest.fn();
    const {getByTestId} = render(
      <McqQuestion
        question={buildQuestion('mcq_multi')}
        state={{selectedOptionIds: ['a', 'b']}}
        onChange={onChange}
      />,
    );

    fireEvent.press(getByTestId('mcq-option-a'));
    expect(onChange).toHaveBeenCalledWith({selectedOptionIds: ['b']});
  });
});
