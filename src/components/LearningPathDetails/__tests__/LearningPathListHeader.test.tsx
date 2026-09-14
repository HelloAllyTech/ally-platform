import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {LearningPathListHeader} from '../LearningPathListHeader';

jest.mock('@/components', () => {
  const React = require('react');
  const {TouchableOpacity, Text} = require('react-native');
  return {
    Button: ({
      label,
      onPress,
      isDisabled,
      isLoading,
    }: {
      label: string;
      onPress: () => void;
      isDisabled: boolean;
      isLoading: boolean;
    }) =>
      React.createElement(
        TouchableOpacity,
        {
          testID: 'start-button',
          onPress,
          accessibilityState: {disabled: isDisabled},
        },
        React.createElement(Text, null, isLoading ? 'Loading' : label),
      ),
  };
});

jest.mock('../ProgressBar', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    ProgressBar: () =>
      React.createElement(View, {testID: 'progress-bar'}),
  };
});

describe('LearningPathListHeader', () => {
  const onStartPress = jest.fn();

  const defaultProps = {
    totalScenarios: 5,
    isCompleted: false,
    startButtonLabel: 'Start',
    onStartPress,
    isStartDisabled: false,
    isCreatingSession: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders title and description', () => {
    const {getByText} = render(
      <LearningPathListHeader
        {...defaultProps}
        title="My Path"
        description="Learn something new"
      />,
    );

    expect(getByText('My Path')).toBeTruthy();
    expect(getByText('Learn something new')).toBeTruthy();
  });

  it('shows cover image when URL provided', () => {
    const coverUrl = 'https://example.com/cover.jpg';
    const {toJSON} = render(
      <LearningPathListHeader {...defaultProps} coverImageUrl={coverUrl} />,
    );

    const treeStr = JSON.stringify(toJSON());
    expect(treeStr).toContain(coverUrl);
  });

  it('does not show image without URL', () => {
    const {toJSON} = render(
      <LearningPathListHeader {...defaultProps} />,
    );

    const treeStr = JSON.stringify(toJSON());
    expect(treeStr).not.toContain('https://example.com/cover.jpg');
  });

  it('shows progress bar when completedScenarios present', () => {
    const {getByTestId} = render(
      <LearningPathListHeader
        {...defaultProps}
        completedScenarios={2}
        totalScenarios={5}
      />,
    );

    expect(getByTestId('progress-bar')).toBeTruthy();
  });

  it('hides button when isCompleted', () => {
    const {queryByTestId} = render(
      <LearningPathListHeader {...defaultProps} isCompleted />,
    );

    expect(queryByTestId('start-button')).toBeNull();
  });

  it('shows button when not completed', () => {
    const {getByTestId} = render(
      <LearningPathListHeader {...defaultProps} />,
    );

    expect(getByTestId('start-button')).toBeTruthy();
  });

  it('calls onStartPress when button pressed', () => {
    const {getByTestId} = render(
      <LearningPathListHeader {...defaultProps} />,
    );

    fireEvent.press(getByTestId('start-button'));

    expect(onStartPress).toHaveBeenCalledTimes(1);
  });

  it('shows a tap hint and calls onProgressPress when the bar is tappable', () => {
    const onProgressPress = jest.fn();
    const {getByTestId, getByText} = render(
      <LearningPathListHeader
        {...defaultProps}
        completedScenarios={2}
        totalScenarios={5}
        onProgressPress={onProgressPress}
      />,
    );

    // useTranslate isn't mocked here (unlike screen-level tests), so it
    // falls back to the raw key — asserting on the key confirms the hint
    // text renders at all, which is what this test is about.
    expect(getByText('courses.progressDashboard.tapHint')).toBeTruthy();

    fireEvent.press(getByTestId('learning-path-progress-bar'));

    expect(onProgressPress).toHaveBeenCalledTimes(1);
  });

  it('shows no tap hint when the bar has no drill-down', () => {
    const {queryByText} = render(
      <LearningPathListHeader
        {...defaultProps}
        completedScenarios={2}
        totalScenarios={5}
      />,
    );

    expect(queryByText('courses.progressDashboard.tapHint')).toBeNull();
  });
});
