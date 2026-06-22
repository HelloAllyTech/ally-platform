import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
}));

jest.mock('@/assets', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    ArrowUpRight: () => <View testID="arrow-up-right" />,
  };
});

jest.mock('@/constants', () => ({
  ASK_AI_EMPTY_STATE_QUESTIONS: ['Question 1', 'Question 2'],
}));

import {AskAiInitialState} from '../AskAiInitialState';

describe('AskAiInitialState', () => {
  it('renders without crashing', () => {
    const onQuestionSelection = jest.fn();
    const {toJSON} = render(
      <AskAiInitialState onQuestionSelection={onQuestionSelection} />,
    );
    expect(toJSON()).toBeTruthy();
  });

  it('renders title and description translation keys', () => {
    const onQuestionSelection = jest.fn();
    const {getByText} = render(
      <AskAiInitialState onQuestionSelection={onQuestionSelection} />,
    );
    expect(getByText(/askAi\.initial\.titlePrefix/)).toBeTruthy();
    expect(getByText(/askAi\.initial\.titleSuffix/)).toBeTruthy();
    expect(getByText('askAi.initial.subtitle')).toBeTruthy();
  });

  it('renders question items from constants', () => {
    const onQuestionSelection = jest.fn();
    const {getByText} = render(
      <AskAiInitialState onQuestionSelection={onQuestionSelection} />,
    );
    expect(getByText('Question 1')).toBeTruthy();
    expect(getByText('Question 2')).toBeTruthy();
  });

  it('calls onQuestionSelection with question text when pressed', () => {
    const onQuestionSelection = jest.fn();
    const {getByText} = render(
      <AskAiInitialState onQuestionSelection={onQuestionSelection} />,
    );
    fireEvent.press(getByText('Question 1'));
    expect(onQuestionSelection).toHaveBeenCalledWith('Question 1');
  });
});
