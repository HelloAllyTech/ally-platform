import React from 'react';
import {Alert, Text} from 'react-native';
import {act, fireEvent, render} from '@testing-library/react-native';

import {OtpVerification} from '../OtpVerification';

const mockFocusFirst = jest.fn();

jest.mock('../../OtpInput/OtpInput', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    OtpInput: React.forwardRef((props: any, ref: any) => {
      React.useImperativeHandle(ref, () => ({focusFirst: mockFocusFirst}));
      return <Text testID="otp-input-mock" />;
    }),
  };
});

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

jest.mock('@/store/hooks', () => ({useAppDispatch: () => jest.fn()}));
jest.mock('@/store/slices/userSlice', () => ({storeTokens: (p: any) => ({type: 'store', payload: p})}));
jest.mock('@/hooks', () => ({useTranslate: () => ({t: (k: string) => k})}));

describe('OtpVerification behavior', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockFocusFirst.mockReset();
    mockVerify.mockReset();
    mockGen.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('enables resend after countdown and calls generateOtp then focuses first input', async () => {
    const {UNSAFE_getByType} = render(
      <OtpVerification email="user@example.com" onOtpVerificationSuccess={jest.fn()} />,
    );

    // Initially disabled, advance countdown
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });

    const {TouchableOpacity} = require('react-native');
    const resendTouchable = UNSAFE_getByType(TouchableOpacity);
    await act(async () => {
      fireEvent.press(resendTouchable);
    });
    expect(mockGen).toHaveBeenCalledWith({email: 'user@example.com'});
    expect(mockFocusFirst).toHaveBeenCalled();
  });

  it('shows alert when resend fails', async () => {
    mockGen.mockRejectedValueOnce(new Error('boom'));
    const {UNSAFE_getByType} = render(
      <OtpVerification email="user@example.com" onOtpVerificationSuccess={jest.fn()} />,
    );
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    const {TouchableOpacity} = require('react-native');
    const resendTouchable2 = UNSAFE_getByType(TouchableOpacity);
    await act(async () => {
      fireEvent.press(resendTouchable2);
    });
    expect(Alert.alert).toHaveBeenCalled();
  });
});


