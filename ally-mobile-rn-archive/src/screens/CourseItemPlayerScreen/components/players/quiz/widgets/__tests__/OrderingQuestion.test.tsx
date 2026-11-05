import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {SanitizedQuizQuestion} from '@/types';

import {OrderingQuestion} from '../OrderingQuestion';

jest.mock('@/hooks', () => ({
  useTranslate: jest.fn(() => ({
    t: (key: string) => key,
    tVariable: (key: string) => key,
  })),
}));

const question: SanitizedQuizQuestion = {
  id: 'q1',
  type: 'ordering',
  prompt: 'Order these',
  points: 1,
  items: [
    {id: 'a', text: 'First'},
    {id: 'b', text: 'Second'},
    {id: 'c', text: 'Third'},
  ],
};

describe('OrderingQuestion', () => {
  it('moving the middle item up swaps it with the one above', () => {
    const onChange = jest.fn();
    const {getByTestId} = render(
      <OrderingQuestion
        question={question}
        state={{orderedItemIds: ['a', 'b', 'c']}}
        onChange={onChange}
      />,
    );

    fireEvent.press(getByTestId('ordering-up-b'));
    expect(onChange).toHaveBeenCalledWith({orderedItemIds: ['b', 'a', 'c']});
  });

  it('moving the middle item down swaps it with the one below', () => {
    const onChange = jest.fn();
    const {getByTestId} = render(
      <OrderingQuestion
        question={question}
        state={{orderedItemIds: ['a', 'b', 'c']}}
        onChange={onChange}
      />,
    );

    fireEvent.press(getByTestId('ordering-down-b'));
    expect(onChange).toHaveBeenCalledWith({orderedItemIds: ['a', 'c', 'b']});
  });

  it('the first item cannot move up, the last item cannot move down', () => {
    const onChange = jest.fn();
    const {getByTestId} = render(
      <OrderingQuestion
        question={question}
        state={{orderedItemIds: ['a', 'b', 'c']}}
        onChange={onChange}
      />,
    );

    fireEvent.press(getByTestId('ordering-up-a'));
    fireEvent.press(getByTestId('ordering-down-c'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
