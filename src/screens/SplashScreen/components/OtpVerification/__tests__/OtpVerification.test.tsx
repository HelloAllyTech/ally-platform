import React from 'react';
import {Text, TouchableOpacity, TextInput, View} from 'react-native';
import {fireEvent, render, waitFor} from '@testing-library/react-native';

import {OtpVerification} from '../OtpVerification';
import * as services from '@/services';

// Mock Components
jest.mock('@/components', () => {
  const React = require('react');
  const {Text, TouchableOpacity} = require('react-native');
  return {
    Button: ({label, onPress, isDisabled}: any) => (
      <TouchableOpacity
        testID="primary-button"
        onPress={isDisabled ? undefined : onPress}
        accessibilityState={{disabled: isDisabled}}>
        <Text>{label}</Text>
      </TouchableOpacity>
    ),
    useToast: () => ({showToast: jest.fn()}),
  };
});

jest.mock('../../TermsAndAgreementModal', () => {
  const React = require('react');
  const {Text, TouchableOpacity} = require('react-native');
  return {
    TermsAndAgreementModal: ({visible, onAgree}: any) =>
      visible ? (
        <TouchableOpacity testID="terms-modal-agree" onPress={onAgree}>
          <Text>Terms Modal Agree</Text>
        </TouchableOpacity>
      ) : null,
  };
});

// Mock Services
const mockVerify = jest.fn();
const mockGen = jest.fn();

const mockUseVerifyOtpMutation = jest.fn();
const mockUseGenerateOtpMutation = jest.fn();

jest.mock('@/services', () => ({
  useVerifyOtpMutation: () => mockUseVerifyOtpMutation(),
  useGenerateOtpMutation: () => mockUseGenerateOtpMutation(),
}));

const mockDispatch = jest.fn();
jest.mock('@/store/hooks', () => ({useAppDispatch: () => mockDispatch}));
jest.mock('@/store/slices/userSlice', () => ({
  storeTokens: (p: any) => ({type: 'store', payload: p}),
}));
jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (k: string) => k}),
  useAppNavigation: () => ({replace: jest.fn()}),
}));

describe('OtpVerification', () => {
  const mockOnSuccess = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();

    // Default mock implementations
    mockUseVerifyOtpMutation.mockReturnValue([
        mockVerify,
        {isLoading: false, isSuccess: false, isError: false, data: undefined},
    ]);
    mockUseGenerateOtpMutation.mockReturnValue([mockGen, {isLoading: false}]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders Trans-based copy without an uninitialized-i18next warning', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    render(
      <OtpVerification
        email="user@example.com"
        onOtpVerificationSuccess={mockOnSuccess}
      />,
    );

    const i18nWarning = warnSpy.mock.calls.find(call =>
      String(call[0]).includes('i18next instance'),
    );
    expect(i18nWarning).toBeUndefined();

    warnSpy.mockRestore();
  });

  it('disables verify button until OTP complete then calls verify', () => {
    const {UNSAFE_getAllByType, getByTestId} = render(
      <OtpVerification
        email="user@example.com"
        onOtpVerificationSuccess={mockOnSuccess}
      />,
    );

    const button = getByTestId('primary-button');
    expect(button.props.accessibilityState.disabled).toBe(true);

    // Fill OTP
    const inputs = UNSAFE_getAllByType(TextInput);
    fireEvent.changeText(inputs[0], '1');
    fireEvent.changeText(inputs[1], '2');
    fireEvent.changeText(inputs[2], '3');
    fireEvent.changeText(inputs[3], '4');

    expect(button.props.accessibilityState.disabled).toBe(false);

    fireEvent.press(button);
    expect(mockVerify).toHaveBeenCalledWith({
      email: 'user@example.com',
      otp: '1234',
    });
  });

  it('shows terms modal after successful OTP verification', async () => {
    // Initial state: not success
    mockUseVerifyOtpMutation.mockReturnValue([
        mockVerify,
        {isLoading: false, isSuccess: false, data: undefined},
    ]);

    const {getByTestId, UNSAFE_getAllByType, rerender} = render(
      <OtpVerification
        email="user@example.com"
        onOtpVerificationSuccess={mockOnSuccess}
      />,
    );

    // Pre-fill OTP
    const inputs = UNSAFE_getAllByType(TextInput);
    fireEvent.changeText(inputs[0], '1');
    fireEvent.changeText(inputs[1], '2');
    fireEvent.changeText(inputs[2], '3');
    fireEvent.changeText(inputs[3], '4');

    // Simulate success
    mockUseVerifyOtpMutation.mockReturnValue([
        mockVerify,
        {
            isLoading: false,
            isSuccess: true,
            isError: false,
            data: {accessToken: 'access', refreshToken: 'refresh'},
        },
    ]);

    rerender(
      <OtpVerification
        email="user@example.com"
        onOtpVerificationSuccess={mockOnSuccess}
      />
    );
    
    await waitFor(() => {
        expect(getByTestId('terms-modal-agree')).toBeTruthy();
    });

    expect(mockOnSuccess).not.toHaveBeenCalled();
  });

  it('completes verification after accepting terms', async () => {
    mockDispatch.mockResolvedValue({unwrap: jest.fn()});
    
    // Initial state: not success
    mockUseVerifyOtpMutation.mockReturnValue([
        mockVerify,
        {isLoading: false, isSuccess: false, data: undefined},
    ]);

    const {getByTestId, UNSAFE_getAllByType, rerender} = render(
      <OtpVerification
        email="user@example.com"
        onOtpVerificationSuccess={mockOnSuccess}
      />,
    );

    // Pre-fill OTP
    const inputs = UNSAFE_getAllByType(TextInput);
    fireEvent.changeText(inputs[0], '1');
    fireEvent.changeText(inputs[1], '2');
    fireEvent.changeText(inputs[2], '3');
    fireEvent.changeText(inputs[3], '4');

    // Simulate success
    mockUseVerifyOtpMutation.mockReturnValue([
        mockVerify,
        {
            isLoading: false,
            isSuccess: true,
            isError: false,
            data: {accessToken: 'access', refreshToken: 'refresh'},
        },
    ]);

    rerender(
      <OtpVerification
        email="user@example.com"
        onOtpVerificationSuccess={mockOnSuccess}
      />
    );
    
    await waitFor(() => {
        expect(getByTestId('terms-modal-agree')).toBeTruthy();
    });

    // Accept terms
    fireEvent.press(getByTestId('terms-modal-agree'));

    await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalled();
        expect(mockOnSuccess).toHaveBeenCalledWith('1234');
    });
  });
});
