import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';
import {ActivityIndicator} from 'react-native';

import {AppleLoginButton} from '../AppleLoginButton';

jest.mock('@invertase/react-native-apple-authentication', () => {
  const React = require('react');
  const {Text} = require('react-native');
  const AppleButton: any = ({onPress}: {onPress: () => void}) =>
    React.createElement(
      Text,
      {accessibilityRole: 'button', onPress, testID: 'native-apple-button'},
      'Continue with Apple',
    );
  AppleButton.Style = {BLACK: 'BLACK', WHITE: 'WHITE'};
  AppleButton.Type = {CONTINUE: 'CONTINUE', SIGN_IN: 'SIGN_IN'};
  return {AppleButton};
});

describe('AppleLoginButton', () => {
  const defaultProps = {onPress: jest.fn()};

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the native Apple button', () => {
    const {getByTestId} = render(<AppleLoginButton {...defaultProps} />);
    expect(getByTestId('native-apple-button')).toBeTruthy();
  });

  it('calls onPress when pressed', () => {
    const onPress = jest.fn();
    const {getByTestId} = render(<AppleLoginButton onPress={onPress} />);
    fireEvent.press(getByTestId('native-apple-button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows loader and hides Apple button when isLoading', () => {
    const {queryByTestId, UNSAFE_getByType} = render(
      <AppleLoginButton {...defaultProps} isLoading />,
    );
    expect(queryByTestId('native-apple-button')).toBeNull();
    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  });

  it('blocks pointer events when disabled', () => {
    const onPress = jest.fn();
    const {getByTestId} = render(
      <AppleLoginButton onPress={onPress} isDisabled testID="apple-wrapper" />,
    );
    const wrapper = getByTestId('apple-wrapper');
    expect(wrapper.props.pointerEvents).toBe('none');
  });
});
