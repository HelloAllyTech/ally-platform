import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {TrueFalseQuestion} from '../TrueFalseQuestion';

jest.mock('@/hooks', () => ({
  useTranslate: jest.fn(() => ({
    t: (key: string) => key,
    tVariable: (key: string) => key,
  })),
}));

describe('TrueFalseQuestion', () => {
  it('selecting True calls onChange with booleanAnswer: true', () => {
    const onChange = jest.fn();
    const {getByTestId} = render(
      <TrueFalseQuestion state={{}} onChange={onChange} />,
    );
    fireEvent.press(getByTestId('true-false-true'));
    expect(onChange).toHaveBeenCalledWith({booleanAnswer: true});
  });

  it('selecting False calls onChange with booleanAnswer: false', () => {
    const onChange = jest.fn();
    const {getByTestId} = render(
      <TrueFalseQuestion state={{booleanAnswer: true}} onChange={onChange} />,
    );
    fireEvent.press(getByTestId('true-false-false'));
    expect(onChange).toHaveBeenCalledWith({booleanAnswer: false});
  });
});
