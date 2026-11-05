import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {SanitizedQuizQuestion} from '@/types';

import {MatchingQuestion} from '../MatchingQuestion';

jest.mock('@/hooks', () => ({
  useTranslate: jest.fn(() => ({
    t: (key: string) => key,
    tVariable: (key: string) => key,
  })),
}));

const question: SanitizedQuizQuestion = {
  id: 'q1',
  type: 'matching',
  prompt: 'Match these',
  points: 1,
  left: [{id: 'l1', text: 'Left 1'}, {id: 'l2', text: 'Left 2'}],
  right: [{id: 'r1', text: 'Right 1'}, {id: 'r2', text: 'Right 2'}],
};

describe('MatchingQuestion', () => {
  it('tapping a left then a right creates a pair', () => {
    const onChange = jest.fn();
    const {getByTestId} = render(
      <MatchingQuestion question={question} state={{pairs: []}} onChange={onChange} />,
    );

    fireEvent.press(getByTestId('matching-left-l1'));
    fireEvent.press(getByTestId('matching-right-r1'));

    expect(onChange).toHaveBeenCalledWith({pairs: [{leftId: 'l1', rightId: 'r1'}]});
  });

  it('tapping an already-paired left breaks the pair', () => {
    const onChange = jest.fn();
    const {getByTestId} = render(
      <MatchingQuestion
        question={question}
        state={{pairs: [{leftId: 'l1', rightId: 'r1'}]}}
        onChange={onChange}
      />,
    );

    fireEvent.press(getByTestId('matching-left-l1'));
    expect(onChange).toHaveBeenCalledWith({pairs: []});
  });

  it('re-pairing a left evicts its previous pair', () => {
    const onChange = jest.fn();
    const {getByTestId} = render(
      <MatchingQuestion
        question={question}
        state={{pairs: [{leftId: 'l1', rightId: 'r1'}]}}
        onChange={onChange}
      />,
    );

    fireEvent.press(getByTestId('matching-left-l2'));
    fireEvent.press(getByTestId('matching-right-r1'));

    expect(onChange).toHaveBeenCalledWith({
      pairs: [{leftId: 'l2', rightId: 'r1'}],
    });
  });
});
