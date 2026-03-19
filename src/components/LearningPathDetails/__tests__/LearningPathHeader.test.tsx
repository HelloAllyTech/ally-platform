import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {LearningPathHeader} from '../LearningPathHeader';

jest.mock('@/assets', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    BoltIcon: (props: object) =>
      React.createElement(View, {...props, testID: 'bolt-icon'}),
    LeftArrowIcon: (props: object) =>
      React.createElement(View, {...props, testID: 'back-button'}),
  };
});

describe('LearningPathHeader', () => {
  const onBackPress = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders title', () => {
    const {getByText} = render(
      <LearningPathHeader title="Learning Path" onBackPress={onBackPress} />,
    );

    expect(getByText('Learning Path')).toBeTruthy();
  });

  it('calls onBackPress when back pressed', () => {
    const {getByTestId} = render(
      <LearningPathHeader title="Learning Path" onBackPress={onBackPress} />,
    );

    fireEvent.press(getByTestId('back-button'));

    expect(onBackPress).toHaveBeenCalledTimes(1);
  });

  it('shows credits when provided', () => {
    const credits = {consumed: 5, limit: 10, isLow: false};
    const {getByTestId, getByText} = render(
      <LearningPathHeader
        title="Path"
        onBackPress={onBackPress}
        credits={credits}
      />,
    );

    expect(getByTestId('bolt-icon')).toBeTruthy();
    expect(getByText('5/10')).toBeTruthy();
  });

  it('does not show credits when not provided', () => {
    const {queryByTestId} = render(
      <LearningPathHeader title="Path" onBackPress={onBackPress} />,
    );

    expect(queryByTestId('bolt-icon')).toBeNull();
  });

  it('shows consumed and limit values', () => {
    const credits = {consumed: 3, limit: 8, isLow: false};
    const {getByText} = render(
      <LearningPathHeader
        title="Path"
        onBackPress={onBackPress}
        credits={credits}
      />,
    );

    expect(getByText('3/8')).toBeTruthy();
  });

  it('renders with isLow credits', () => {
    const credits = {consumed: 1, limit: 5, isLow: true};
    const {getByText} = render(
      <LearningPathHeader
        title="Path"
        onBackPress={onBackPress}
        credits={credits}
      />,
    );

    expect(getByText('1/5')).toBeTruthy();
  });
});
