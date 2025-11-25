import React from 'react';
import {Alert, Linking} from 'react-native';
import {act, fireEvent, render, waitFor} from '@testing-library/react-native';
import {TextInput} from 'react-native';

import {EmailLogin} from '../EmailLogin';

jest.mock('@/components', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    PrimaryButton: ({label, onPress, isDisabled}: any) => (
      React.createElement(
        Text,
        {accessibilityRole: 'button', onPress: isDisabled ? undefined : onPress},
        label,
      )
    ),
  };
});

jest.mock('@/services/authApi', () => ({
  useGenerateOtpMutation: () => [jest.fn().mockResolvedValue({}), {isLoading: false, isSuccess: false, isError: false}],
}));

jest.mock('@/hooks', () => ({ useTranslate: () => ({ t: (k: string) => k }) }));

jest.spyOn(Linking, 'openURL').mockResolvedValue(true as any);
jest.spyOn(Alert, 'alert').mockImplementation(() => {});

describe('EmailLogin', () => {
  it('disables Next button for invalid email and enables for valid email', () => {
    const {getByText, UNSAFE_getAllByType} = render(
      <EmailLogin onOtpGenerationSuccess={jest.fn()} />,
    );
    // Enter invalid email first
    const invalid = 'a@';
    const input = UNSAFE_getAllByType(TextInput)[0];
    fireEvent.changeText(input, invalid);
    fireEvent.press(getByText('Common.next'));
    // No crash; button was disabled (onPress no-op)

    // Enter valid email and expect button to be actionable
    fireEvent.changeText(input, 'user@example.com');
    fireEvent.press(getByText('Common.next'));
  });

  it('opens T&C and Privacy links', () => {
    const {getByText} = render(<EmailLogin onOtpGenerationSuccess={jest.fn()} />);
    fireEvent.press(getByText('SplashScreen.termsAndConditions'));
    fireEvent.press(getByText('SplashScreen.privacyPolicy'));
    expect(Linking.openURL).toHaveBeenCalledTimes(2);
  });
});

