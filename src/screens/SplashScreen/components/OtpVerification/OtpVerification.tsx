import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Trans} from 'react-i18next';
import {Text, TouchableOpacity, View} from 'react-native';
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scroll-view';

import {Button, useToast} from '@/components';
import {
  DEFAULT_OTP_EXPIRY_MINUTES,
  isIOS,
  MINUTES_IN_SECONDS,
  RESEND_COUNTDOWN_SECONDS,
  SCREEN_NAMES,
} from '@/constants';
import {useAppNavigation, useTranslate} from '@/hooks';
import {
  AuthResponse,
  useGenerateOtpMutation,
  useVerifyOtpMutation,
} from '@/services';
import {useAppDispatch} from '@/store/hooks';
import {storeTokens} from '@/store/slices/userSlice';
import {getErrorDetails, isSuspendedUserError} from '@/utils';

import {OtpInput, OtpInputRef} from '../OtpInput/OtpInput';
import {TermsAndAgreementModal} from '../TermsAndAgreementModal';
import {styles} from './styles';
import type {OtpVerificationProps} from './types';

const DEFAULT_OTP = ['', '', '', ''];

export const OtpVerification: React.FC<OtpVerificationProps> = ({
  email,
  onOtpVerificationSuccess,
  initialExpiresIn,
}) => {
  const [otpValue, setOtpValue] = useState(DEFAULT_OTP);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(RESEND_COUNTDOWN_SECONDS);
  const [isResendDisabled, setIsResendDisabled] = useState(true);
  const [otpExpiryMinutes, setOtpExpiryMinutes] = useState(() => {
    if (initialExpiresIn) {
      return Math.ceil(initialExpiresIn / MINUTES_IN_SECONDS);
    }
    return DEFAULT_OTP_EXPIRY_MINUTES;
  });

  const tempTokensRef = useRef<AuthResponse | null>(null);

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
    (tokens: AuthResponse) => {
      dispatch(storeTokens(tokens));
      onOtpVerificationSuccess(otp);
    },
    [dispatch, onOtpVerificationSuccess, otp],
  );

  useEffect(() => {
    if (isSuccess && data) {
      const newTokens = {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      };
      tempTokensRef.current = newTokens;
      setShowTermsModal(true);
    }
  }, [isSuccess, data]);

  useEffect(() => {
    if (isError && apiError) {
      // Check if user is suspended
      if (isSuspendedUserError(apiError)) {
        navigation.replace(SCREEN_NAMES.SUSPENDED_ACCOUNT);
        return;
      }

      const errorDetails = getErrorDetails(apiError);
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
    setCountdown(RESEND_COUNTDOWN_SECONDS);
    setIsResendDisabled(true);
  }, []);

  const handleResendOtp = useCallback(async () => {
    try {
      const response = await generateOtp({email});
      if (response.data?.expiresIn) {
        const expiryMinutes = Math.ceil(response.data.expiresIn / 60);
        setOtpExpiryMinutes(expiryMinutes);
      }
      resetOtpState();
      otpInputRef.current?.focusFirst();
    } catch (err) {
      showToast(getErrorDetails(err).message, 'error');
    }
  }, [email, generateOtp, resetOtpState, showToast]);

  const handleAcceptTerms = useCallback(() => {
    const tokens = tempTokensRef.current;
    if (!tokens) return;

    setShowTermsModal(false);
    completeVerification(tokens);
  }, [completeVerification]);

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
            {t('auth.login.otp.enterCode')}
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
          <View style={styles.expiryContainer}>
            <Text style={styles.expiryText}>
              <Trans
                i18nKey="auth.login.otp.expires"
                values={{minutes: otpExpiryMinutes}}
                components={{
                  bold: <Text style={styles.expiryBoldText} />,
                }}
              />
            </Text>
            <TouchableOpacity
              style={styles.resendInlineButton}
              onPress={handleResendOtp}
              disabled={isResendDisabled || isResending}>
              <Text
                style={[
                  styles.resendButtonText,
                  (isResendDisabled || isResending) &&
                    styles.resendButtonDisabled,
                ]}>
                {t('auth.login.otp.resend')}{' '}
                {countdown > 0 ? `(${countdown}s)` : ''}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAwareScrollView>

      <Button
        label={t('auth.login.otp.verify')}
        onPress={handleSubmit}
        isDisabled={!isOtpComplete || showTermsModal}
        isLoading={isVerifying}
      />

      <TermsAndAgreementModal
        visible={showTermsModal}
        onAgree={handleAcceptTerms}
      />
    </View>
  );
};
