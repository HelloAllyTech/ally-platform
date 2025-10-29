import React from 'react';
import {Text} from 'react-native';
import {act, fireEvent, render, waitFor} from '@testing-library/react-native';

import {OtpVerification} from '../OtpVerification';

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

const mockVerify = jest.fn();
const mockGen = jest.fn();

jest.mock('@/services', () => ({
  useVerifyOtpMutation: () => [mockVerify, {isLoading: false, isSuccess: false, isError: false, data: undefined}],
  useGenerateOtpMutation: () => [mockGen, {isLoading: false}],
}));

jest.mock('@/store/hooks', () => ({ useAppDispatch: () => jest.fn() }));
jest.mock('@/store/slices/userSlice', () => ({ storeTokens: (p: any) => ({ type: 'store', payload: p }) }));
jest.mock('@/hooks', () => ({ 
  useTranslate: () => ({ t: (k: string) => k }),
  useAppNavigation: () => ({ replace: jest.fn() })
}));

describe('OtpVerification', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockVerify.mockReset();
    mockGen.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('disables verify button until OTP complete then calls verify', () => {
    const {getByText, UNSAFE_getAllByType} = render(
      <OtpVerification email="user@example.com" onOtpVerificationSuccess={jest.fn()} />,
    );
    const button = getByText('SplashScreen.verifyOtp');
    // Not complete yet -> pressing does nothing
    fireEvent.press(button);

    // Fill OTP through exposed TextInputs
    const {TextInput} = require('react-native');
    const inputs = UNSAFE_getAllByType(TextInput);
    fireEvent.changeText(inputs[0], '1');
    fireEvent.changeText(inputs[1], '2');
    fireEvent.changeText(inputs[2], '3');
    fireEvent.changeText(inputs[3], '4');

    fireEvent.press(button);
    expect(mockVerify).toHaveBeenCalledWith({ 
      email: 'user@example.com', 
      otp: '1234', 
      allowedRoles: ['COUNSELOR', 'LEARNER', 'ADMIN'] 
    });
  });

});

