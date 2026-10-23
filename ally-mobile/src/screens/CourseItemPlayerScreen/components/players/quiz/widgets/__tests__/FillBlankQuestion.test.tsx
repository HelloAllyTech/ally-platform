import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {SanitizedQuizQuestion} from '@/types';

import {FillBlankQuestion} from '../FillBlankQuestion';

const question: SanitizedQuizQuestion = {
  id: 'q1',
  type: 'fill_blank',
  prompt: 'Fill it in',
  points: 1,
  template: 'The {{a}} sat on the {{b}}.',
  blankIds: ['a', 'b'],
};

describe('FillBlankQuestion', () => {
  it('renders one labeled input per blank in the template', () => {
    const {getByTestId} = render(
      <FillBlankQuestion question={question} state={{blanks: {}}} onChange={jest.fn()} />,
    );
    expect(getByTestId('fill-blank-input-a')).toBeTruthy();
    expect(getByTestId('fill-blank-input-b')).toBeTruthy();
  });

  it('typing into a blank merges it into the existing blanks map', () => {
    const onChange = jest.fn();
    const {getByTestId} = render(
      <FillBlankQuestion
        question={question}
        state={{blanks: {a: 'cat'}}}
        onChange={onChange}
      />,
    );

    fireEvent.changeText(getByTestId('fill-blank-input-b'), 'mat');
    expect(onChange).toHaveBeenCalledWith({blanks: {a: 'cat', b: 'mat'}});
  });
});
