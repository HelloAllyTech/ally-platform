import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Alert, Text, TouchableOpacity, View} from 'react-native';
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scroll-view';

import {PrimaryButton} from '@/components';
import {ALLOWED_ROLES, isIOS} from '@/constants';
import {useTranslate} from '@/hooks';
import {useGenerateOtpMutation, useVerifyOtpMutation} from '@/services';
import {useAppDispatch} from '@/store/hooks';
import {storeTokens} from '@/store/slices/userSlice';
import {getErrorDetails} from '@/utils';

import {OtpInput, OtpInputRef} from '../OtpInput/OtpInput';
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
  const otpInputRef = useRef<OtpInputRef>(null);
  const dispatch = useAppDispatch();

  const [
    verifyOtp,
    {isLoading: isVerifying, isSuccess, isError, error: apiError, data},
  ] = useVerifyOtpMutation();
  const [generateOtp, {isLoading: isResending}] = useGenerateOtpMutation();
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

  useEffect(() => {
    if (isSuccess && data) {
      // Store tokens securely
      dispatch(
        storeTokens({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
        }),
      );
      onOtpVerificationSuccess(otp);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, data, otp]);

  useEffect(() => {
    if (isError && apiError) {
      setError(getErrorDetails(apiError).message);
    }
  }, [isError, apiError]);

  const handleOtpChange = useCallback((newValue: string[]) => {
    setOtpValue(newValue);
    setError('');
  }, []);

  const handleSubmit = useCallback(() => {
    verifyOtp({email, otp, allowedRoles: ALLOWED_ROLES});
  }, [email, otp, verifyOtp]);

  const resetOtpState = useCallback(() => {
    setOtpValue(DEFAULT_OTP);
    setError('');
    setCountdown(10);
    setIsResendDisabled(true);
  }, []);

  const handleResendOtp = useCallback(async () => {
    try {
      await generateOtp({email, allowedRoles: ALLOWED_ROLES});
      resetOtpState();
      otpInputRef.current?.focusFirst();
    } catch (err) {
      Alert.alert('Error', getErrorDetails(err).message);
    }
  }, [email, generateOtp, resetOtpState]);

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
        isDisabled={!isOtpComplete}
        isLoading={isVerifying}
      />
    </View>
  );
};
