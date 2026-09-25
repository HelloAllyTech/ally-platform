import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {SanitizedQuizQuestion} from '@/types';

import {LikertScaleQuestion} from '../LikertScaleQuestion';

jest.mock('@/hooks', () => ({
  useTranslate: jest.fn(() => ({
    t: (key: string) => key,
    tVariable: (key: string) => key,
  })),
}));

const question: SanitizedQuizQuestion = {
  id: 'q1',
  type: 'likert_scale',
  prompt: 'Rate these statements',
  points: 0,
  graded: false,
  statements: [
    {id: 's1', text: 'I feel confident'},
    {id: 's2', text: 'I feel supported'},
  ],
  scale: [
    {id: 'sc1', text: 'Strongly disagree'},
    {id: 'sc2', text: 'Disagree'},
    {id: 'sc3', text: 'Neutral'},
    {id: 'sc4', text: 'Agree'},
    {id: 'sc5', text: 'Strongly agree'},
  ],
};

describe('LikertScaleQuestion', () => {
  it('renders every statement with its scale as selectable pills', () => {
    const {getByText, getByTestId} = render(
      <LikertScaleQuestion question={question} state={{}} onChange={jest.fn()} />,
    );

    expect(getByText('I feel confident')).toBeTruthy();
    expect(getByText('I feel supported')).toBeTruthy();
    expect(getByTestId('likert-option-s1-sc1')).toBeTruthy();
    expect(getByTestId('likert-option-s2-sc5')).toBeTruthy();
  });

  it('selecting a scale point for a statement rates only that statement', () => {
    const onChange = jest.fn();
    const {getByTestId} = render(
      <LikertScaleQuestion
        question={question}
        state={{ratings: {s1: 'sc2'}}}
        onChange={onChange}
      />,
    );

    fireEvent.press(getByTestId('likert-option-s2-sc4'));
    expect(onChange).toHaveBeenCalledWith({
      ratings: {s1: 'sc2', s2: 'sc4'},
    });
  });

  it('re-selecting a different point for an already-rated statement replaces it', () => {
    const onChange = jest.fn();
    const {getByTestId} = render(
      <LikertScaleQuestion
        question={question}
        state={{ratings: {s1: 'sc2'}}}
        onChange={onChange}
      />,
    );

    fireEvent.press(getByTestId('likert-option-s1-sc4'));
    expect(onChange).toHaveBeenCalledWith({ratings: {s1: 'sc4'}});
  });

  it('marks the chosen pill as checked via accessibilityState', () => {
    const {getByTestId} = render(
      <LikertScaleQuestion
        question={question}
        state={{ratings: {s1: 'sc2'}}}
        onChange={jest.fn()}
      />,
    );

    expect(getByTestId('likert-option-s1-sc2').props.accessibilityState).toEqual(
      {checked: true},
    );
    expect(getByTestId('likert-option-s1-sc1').props.accessibilityState).toEqual(
      {checked: false},
    );
  });

  it('gives each statement its own radiogroup', () => {
    const {getByTestId} = render(
      <LikertScaleQuestion question={question} state={{}} onChange={jest.fn()} />,
    );

    expect(getByTestId('likert-statement-s1')).toBeTruthy();
    expect(getByTestId('likert-statement-s2')).toBeTruthy();
  });
});
