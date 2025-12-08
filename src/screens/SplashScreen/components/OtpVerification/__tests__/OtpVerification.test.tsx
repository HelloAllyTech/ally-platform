import React from 'react';
import {Text, TouchableOpacity, TextInput, View} from 'react-native';
import {fireEvent, render, waitFor} from '@testing-library/react-native';

import {OtpVerification} from '../OtpVerification';
import * as services from '@/services';
import {env} from '@/config/env';

// Mock env
jest.mock('@/config/env', () => ({
  env: {
    TERMS_AND_CONDITION_FLAG: true,
  },
}));

// Mock Components
jest.mock('@/components', () => {
  const React = require('react');
  const {Text, TouchableOpacity} = require('react-native');
  return {
    PrimaryButton: ({label, onPress, isDisabled}: any) => (
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
const mockCheckTerms = jest.fn();
const mockAcceptTerms = jest.fn();

const mockUseVerifyOtpMutation = jest.fn();
const mockUseGenerateOtpMutation = jest.fn();
const mockUseLazyCheckTermsAndAgreementQuery = jest.fn();
const mockUseAcceptTermsAndAgreementMutation = jest.fn();

jest.mock('@/services', () => ({
  useVerifyOtpMutation: () => mockUseVerifyOtpMutation(),
  useGenerateOtpMutation: () => mockUseGenerateOtpMutation(),
  useLazyCheckTermsAndAgreementQuery: () => mockUseLazyCheckTermsAndAgreementQuery(),
  useAcceptTermsAndAgreementMutation: () => mockUseAcceptTermsAndAgreementMutation(),
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
    mockUseLazyCheckTermsAndAgreementQuery.mockReturnValue([mockCheckTerms, {isFetching: false}]);
    mockUseAcceptTermsAndAgreementMutation.mockReturnValue([mockAcceptTerms, {isLoading: false}]);
    
    // Default flag to true
    (env as any).TERMS_AND_CONDITION_FLAG = true;
  });

  afterEach(() => {
    jest.useRealTimers();
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

  describe('When TERMS_AND_CONDITION_FLAG is true', () => {
      beforeEach(() => {
        (env as any).TERMS_AND_CONDITION_FLAG = true;
      });

      it('checks terms after successful verification and completes if already accepted', async () => {
        // Initial state: not success
        mockUseVerifyOtpMutation.mockReturnValue([
            mockVerify,
            {isLoading: false, isSuccess: false, data: undefined},
        ]);
        mockCheckTerms.mockResolvedValue({data: {success: true}});

        const {UNSAFE_getAllByType, rerender} = render(
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
            expect(mockCheckTerms).toHaveBeenCalledWith('access');
        });

        expect(mockDispatch).toHaveBeenCalled();
        expect(mockOnSuccess).toHaveBeenCalledWith('1234');
      });

      it('shows terms modal if terms not accepted', async () => {
        // Initial state
        mockUseVerifyOtpMutation.mockReturnValue([
            mockVerify,
            {isLoading: false, isSuccess: false, data: undefined},
        ]);
        mockCheckTerms.mockResolvedValue({data: {success: false}});

        const {getByTestId, UNSAFE_getAllByType, rerender} = render(
          <OtpVerification
            email="user@example.com"
            onOtpVerificationSuccess={mockOnSuccess}
          />,
        );
        
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
            expect(mockCheckTerms).toHaveBeenCalledWith('access');
        });

        expect(getByTestId('terms-modal-agree')).toBeTruthy();
        expect(mockOnSuccess).not.toHaveBeenCalled();
      });
  });

  describe('When TERMS_AND_CONDITION_FLAG is false', () => {
    beforeEach(() => {
        (env as any).TERMS_AND_CONDITION_FLAG = false;
    });

    it('skips terms check and completes verification immediately', async () => {
        // Initial state
        mockUseVerifyOtpMutation.mockReturnValue([
            mockVerify,
            {isLoading: false, isSuccess: false, data: undefined},
        ]);

        const {UNSAFE_getAllByType, rerender} = render(
            <OtpVerification
                email="user@example.com"
                onOtpVerificationSuccess={mockOnSuccess}
            />,
        );

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
            expect(mockDispatch).toHaveBeenCalled();
        });
        
        expect(mockCheckTerms).not.toHaveBeenCalled();
        expect(mockOnSuccess).toHaveBeenCalledWith('1234');
    });
  });
});
