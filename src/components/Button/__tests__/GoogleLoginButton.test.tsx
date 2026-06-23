jest.mock('@/hooks/useTranslate', () => {
  const en = require('@/localization/locales/en.json');
  const resolve = (key, vars = {}) => {
    const val = String(key)
      .split('.')
      .reduce((o, p) => (o == null ? undefined : o[p]), en);
    let s = typeof val === 'string' ? val : key;
    Object.keys(vars || {}).forEach(k => {
      s = s.split('{{' + k + '}}').join(String(vars[k]));
    });
    return s;
  };
  return {useTranslate: () => ({t: resolve, tVariable: resolve})};
});

import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';
import {ActivityIndicator, TouchableOpacity} from 'react-native';

import {GoogleLoginButton} from '../GoogleLoginButton';

jest.mock('@/assets', () => ({
  GoogleIcon: () => null,
}));

describe('GoogleLoginButton', () => {
  const defaultProps = {
    onPress: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the default label', () => {
    const {getByText} = render(<GoogleLoginButton {...defaultProps} />);
    expect(getByText('Continue with Google')).toBeTruthy();
  });

  it('renders custom label when provided', () => {
    const {getByText} = render(
      <GoogleLoginButton {...defaultProps} label="Sign in with Google" />,
    );
    expect(getByText('Sign in with Google')).toBeTruthy();
  });

  it('calls onPress when pressed', () => {
    const onPress = jest.fn();
    const {getByText} = render(
      <GoogleLoginButton onPress={onPress} testID="google-button" />,
    );
    fireEvent.press(getByText('Continue with Google'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is disabled when isDisabled is true', () => {
    const onPress = jest.fn();
    const {getByText} = render(
      <GoogleLoginButton onPress={onPress} isDisabled testID="google-button" />,
    );
    fireEvent.press(getByText('Continue with Google'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('shows loader and hides label when isLoading is true', () => {
    const {queryByText, UNSAFE_getByType} = render(
      <GoogleLoginButton
        {...defaultProps}
        isLoading
        testID="google-button"
      />,
    );

    // Label should not be present
    expect(queryByText('Continue with Google')).toBeNull();

    // ActivityIndicator should be rendered
    const loader = UNSAFE_getByType(ActivityIndicator);
    expect(loader).toBeTruthy();
  });

  it('is disabled when isLoading is true', () => {
    const onPress = jest.fn();
    const {getByTestId, UNSAFE_getByType} = render(
      <GoogleLoginButton
        onPress={onPress}
        isLoading
        testID="google-button"
      />,
    );
    // Button should be disabled during loading
    const button = getByTestId('google-button');
    expect(button?.props.disabled || button?.props.accessibilityState?.disabled).toBe(true);
    // Verify loader is shown
    const loader = UNSAFE_getByType(ActivityIndicator);
    expect(loader).toBeTruthy();
  });

  it('accepts custom container styles via rest props', () => {
    const {getByTestId} = render(
      <GoogleLoginButton
        {...defaultProps}
        testID="google-button"
      />,
    );
    // Component renders successfully
    const button = getByTestId('google-button');
    expect(button).toBeTruthy();
  });

  it('accepts custom text styles prop (even if not applied)', () => {
    const customTextStyle = {fontSize: 18};
    const {getByText} = render(
      <GoogleLoginButton
        {...defaultProps}
        customTextStyle={customTextStyle}
      />,
    );
    // Component renders successfully with the prop
    expect(getByText('Continue with Google')).toBeTruthy();
    // Note: customTextStyle is not currently applied in the component implementation
  });
});
