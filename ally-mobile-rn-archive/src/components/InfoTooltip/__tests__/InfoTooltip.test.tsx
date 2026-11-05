import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {InfoTooltip} from '../InfoTooltip';

jest.mock('react-native-walkthrough-tooltip', () => {
  const React = require('react');
  const {View, Text} = require('react-native');
  return {
    __esModule: true,
    default: ({children, isVisible, onClose, content, placement}: any) =>
      React.createElement(
        View,
        {testID: 'tooltip-wrapper'},
        children,
        isVisible &&
          React.createElement(
            View,
            {testID: 'tooltip-content'},
            content,
            React.createElement(Text, {
              testID: 'tooltip-close',
              onPress: onClose,
              children: 'Close',
            }),
          ),
      ),
  };
});

jest.mock('@/constants', () => ({
  isIOS: false,
}));

describe('InfoTooltip', () => {
  it('renders children', () => {
    const {Text} = require('react-native');
    const {getByText, getByTestId} = render(
      <InfoTooltip
        content={<></>}
        placement="top"
        isVisible={false}
        onClose={jest.fn()}>
        <Text>Trigger</Text>
      </InfoTooltip>,
    );
    expect(getByTestId('tooltip-wrapper')).toBeTruthy();
    expect(getByText('Trigger')).toBeTruthy();
  });

  it('shows tooltip content when isVisible is true', () => {
    const {Text} = require('react-native');
    const {getByTestId} = render(
      <InfoTooltip
        content={<Text>Tooltip text</Text>}
        placement="top"
        isVisible
        onClose={jest.fn()}>
        <Text>Trigger</Text>
      </InfoTooltip>,
    );
    expect(getByTestId('tooltip-content')).toBeTruthy();
  });

  it('does not show tooltip content when isVisible is false', () => {
    const {Text} = require('react-native');
    const {queryByTestId} = render(
      <InfoTooltip
        content={<Text>Tooltip text</Text>}
        placement="top"
        isVisible={false}
        onClose={jest.fn()}>
        <Text>Trigger</Text>
      </InfoTooltip>,
    );
    expect(queryByTestId('tooltip-content')).toBeNull();
  });

  it('calls onClose when close is triggered', () => {
    const {Text} = require('react-native');
    const onClose = jest.fn();
    const {getByTestId} = render(
      <InfoTooltip
        content={<></>}
        placement="bottom"
        isVisible
        onClose={onClose}>
        <Text>Trigger</Text>
      </InfoTooltip>,
    );
    fireEvent.press(getByTestId('tooltip-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
