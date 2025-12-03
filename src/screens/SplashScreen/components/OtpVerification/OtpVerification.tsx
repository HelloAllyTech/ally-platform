import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scroll-view';

import {PrimaryButton, useToast} from '@/components';
import {env} from '@/config/env';
import {ErrorCode, isIOS, SCREEN_NAMES} from '@/constants';
import {useAppNavigation, useTranslate} from '@/hooks';
import {
  useAcceptTermsAndAgreementMutation,
  useGenerateOtpMutation,
  useLazyCheckTermsAndAgreementQuery,
  useVerifyOtpMutation,
} from '@/services';
import {useAppDispatch} from '@/store/hooks';
import {storeTokens} from '@/store/slices/userSlice';
import {getErrorDetails} from '@/utils';

import {OtpInput, OtpInputRef} from '../OtpInput/OtpInput';
import {TermsAndAgreementModal} from '../TermsAndAgreementModal';
import {styles} from './styles';
import type {OtpVerificationProps} from './types';

const DEFAULT_OTP = ['', '', '', ''];

export const OtpVerification: React.FC<OtpVerificationProps> = ({
  email,
  onOtpVerificationSuccess,
}) => {
  const [otpValue, setOtpValue] = useState(DEFAULT_OTP);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(10);
  const [isResendDisabled, setIsResendDisabled] = useState(true);

  const tempTokensRef = useRef<{
    accessToken: string;
    refreshToken: string;
  } | null>(null);

  const [showTermsModal, setShowTermsModal] = useState(false);
  const otpInputRef = useRef<OtpInputRef>(null);
  const dispatch = useAppDispatch();
  const navigation = useAppNavigation();
  const {showToast} = useToast();

  const [
    verifyOtp,
    {isLoading: isVerifying, isSuccess, isError, error: apiError, data},
  ] = useVerifyOtpMutation();
  const [generateOtp, {isLoading: isResending}] = useGenerateOtpMutation();

  const [checkTermsAndAgreement, {isFetching: isCheckingTerms}] =
    useLazyCheckTermsAndAgreementQuery();

  const [acceptTermsAndAgreement, {isLoading: isAcceptingTerms}] =
    useAcceptTermsAndAgreementMutation();

  const {t} = useTranslate();

  const isOtpComplete = otpValue.every(v => v !== '');
  const otp = otpValue.join('');

  useEffect(() => {
    if (countdown === 0) {
      setIsResendDisabled(false);
      return;
    }
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const completeVerification = useCallback(
    (tokens: {accessToken: string; refreshToken: string}) => {
      dispatch(
        storeTokens({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        }),
      );
      onOtpVerificationSuccess(otp);
    },
    [dispatch, onOtpVerificationSuccess, otp],
  );

  const checkTerms = useCallback(
    async (tokens: {accessToken: string; refreshToken: string}) => {
      try {
        const response = await checkTermsAndAgreement(tokens.accessToken);
        if (response.data?.success) {
          completeVerification(tokens);
        } else {
          setShowTermsModal(true);
        }
      } catch (err) {
        showToast('Failed to check terms acceptance', 'error');
      }
    },
    [checkTermsAndAgreement, completeVerification, showToast],
  );

  useEffect(() => {
    if (isSuccess && data) {
      const newTokens = {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      };
      // Store tokens in ref to be used later if needed (e.g., in handleAgreeTerms)
      tempTokensRef.current = newTokens;
      if (env.TERMS_AND_CONDITION_FLAG) {
        checkTerms(newTokens);
      } else {
        completeVerification(newTokens);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, data]);

  useEffect(() => {
    if (isError && apiError) {
      const errorDetails = getErrorDetails(apiError);

      // Check if user is suspended
      if (
        errorDetails.status === 403 &&
        (errorDetails.error === ErrorCode.USER_SUSPENDED ||
          errorDetails.message === 'User suspended')
      ) {
        navigation.replace(SCREEN_NAMES.SUSPENDED_ACCOUNT);
        return;
      }

      setError(errorDetails.message);
    }
  }, [isError, apiError, navigation]);

  const handleOtpChange = useCallback((newValue: string[]) => {
    setOtpValue(newValue);
    setError('');
  }, []);

  const handleSubmit = useCallback(() => {
    verifyOtp({email, otp});
  }, [email, otp, verifyOtp]);

  const resetOtpState = useCallback(() => {
    setOtpValue(DEFAULT_OTP);
    setError('');
    setCountdown(10);
    setIsResendDisabled(true);
  }, []);

  const handleResendOtp = useCallback(async () => {
    try {
      await generateOtp({email});
      resetOtpState();
      otpInputRef.current?.focusFirst();
    } catch (err) {
      showToast(getErrorDetails(err).message, 'error');
    }
  }, [email, generateOtp, resetOtpState, showToast]);

  const handleAcceptTerms = async () => {
    const tokens = tempTokensRef.current;
    if (!tokens) return;

    try {
      const response = await acceptTermsAndAgreement(tokens.accessToken);
      if (response.data?.success) {
        setShowTermsModal(false);
        completeVerification(tokens);
      } else {
        showToast('Failed to accept terms', 'error');
      }
    } catch (err) {
      showToast('Failed to accept terms', 'error');
    }
  };

  return (
    <View style={styles.container}>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.contentContainer}
        enableOnAndroid
        extraScrollHeight={0}
        showsVerticalScrollIndicator={false}
        enableAutomaticScroll={!isIOS}
        keyboardShouldPersistTaps="handled">
        <View style={styles.containerWrapper}>
          <Text style={styles.headerText}>
            {t('SplashScreen.enterTheCodeSentTo')}
            {'\n'}
            <Text style={styles.emailText}>{email}</Text>
          </Text>

          <View style={styles.otpContainer}>
            <OtpInput
              ref={otpInputRef}
              value={otpValue}
              onChange={handleOtpChange}
              inputCount={4}
              hasError={!!error}
            />
          </View>
          {error ? (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
          <View style={styles.resendContainer}>
            <Text style={styles.helperText}>
              {t('SplashScreen.didNotReceiveTheCode')}
            </Text>
            <TouchableOpacity
              style={styles.resendButton}
              onPress={handleResendOtp}
              disabled={isResendDisabled || isResending}>
              <Text
                style={[
                  styles.resendButtonText,
                  (isResendDisabled || isResending) &&
                    styles.resendButtonDisabled,
                ]}>
                {t('SplashScreen.resend')}{' '}
                {countdown > 0 ? `(${countdown}s)` : ''}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAwareScrollView>

      <PrimaryButton
        label={t('SplashScreen.verifyOtp')}
        onPress={handleSubmit}
        isDisabled={!isOtpComplete || showTermsModal}
        isLoading={isVerifying || isCheckingTerms}
      />

      <TermsAndAgreementModal
        visible={showTermsModal}
        onAgree={handleAcceptTerms}
        isLoading={isAcceptingTerms}
      />
    </View>
  );
};
