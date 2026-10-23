import React, {useCallback, useEffect, useRef, useState} from 'react';
import {SerializedError} from '@reduxjs/toolkit';
import {FetchBaseQueryError} from '@reduxjs/toolkit/query';
import {Alert, Linking, Text, TextInput, View} from 'react-native';
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scroll-view';

import {Button} from '@/components';
import {AppleLoginButton} from '@/components/Button/AppleLoginButton';
import {GoogleLoginButton} from '@/components/Button/GoogleLoginButton';
import {
  isIOS,
  PRIVACY_POLICY_URL,
  TERMS_AND_CONDITIONS_URL,
} from '@/constants/general';
import {useAppleLogin, useGoogleLogin, useTranslate} from '@/hooks';
import {AuthResponse, useGenerateOtpMutation} from '@/services/authApi';
import {useAppDispatch} from '@/store/hooks';
import {storeTokens} from '@/store/slices/userSlice';
import {colors} from '@/theme';
import {getErrorDetails, isValidEmail} from '@/utils';

import {TermsAndAgreementModal} from '../TermsAndAgreementModal';
import {styles} from './styles';
import type {EmailLoginProps} from './types';

export const EmailLogin: React.FC<EmailLoginProps> = ({
  onOtpGenerationSuccess,
  onLoginSuccess,
}) => {
  const [email, setEmail] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const tempTokensRef = useRef<AuthResponse | null>(null);
  const [
    generateOtp,
    {
      isLoading: isOtpLoading,
      isSuccess: isOtpSuccess,
      isError: isOtpError,
      error: otpError,
      data: otpData,
    },
  ] = useGenerateOtpMutation();
  const dispatch = useAppDispatch();

  const handleGoogleLoginSuccess = useCallback((tokens: AuthResponse) => {
    tempTokensRef.current = tokens;
    setShowTermsModal(true);
  }, []);

  const {signIn: handleGoogleSignIn, isLoading: isGoogleLoading} =
    useGoogleLogin({
      onLoginSuccess: handleGoogleLoginSuccess,
    });

  const {signIn: handleAppleSignIn, isLoading: isAppleLoading} = useAppleLogin({
    onLoginSuccess: handleGoogleLoginSuccess,
  });

  const handleAcceptTerms = useCallback(async () => {
    const tokens = tempTokensRef.current;
    if (!tokens) return;

    setShowTermsModal(false);
    await dispatch(storeTokens(tokens)).unwrap();
    tempTokensRef.current = null;
    onLoginSuccess();
  }, [dispatch, onLoginSuccess]);

  const {t} = useTranslate();

  const handleOtpError = useCallback(
    (err: FetchBaseQueryError | SerializedError) => {
      const message = getErrorDetails(err).message;
      Alert.alert(
        t('auth.login.errors.sendOtpFailed'),
        message === 'Network Error'
          ? t('common.checkInternet')
          : message || t('common.unknownError'),
      );
    },
    [t],
  );

  // Handle OTP success
  useEffect(() => {
    if (isOtpSuccess && otpData) {
      onOtpGenerationSuccess(email, otpData.expiresIn);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOtpSuccess, otpData, email]);

  // Handle OTP error
  useEffect(() => {
    if (isOtpError && otpError) {
      handleOtpError(otpError);
    }
  }, [isOtpError, otpError, handleOtpError]);

  const handleEmailChange = useCallback((text: string) => {
    setEmail(text.trim().toLowerCase());
  }, []);

  const handleSubmit = useCallback(async () => {
    if (isValidEmail(email)) {
      await generateOtp({email});
    }
  }, [email, generateOtp]);

  const isLoading = isOtpLoading || isGoogleLoading || isAppleLoading;

  return (
    <View style={styles.container}>
      <KeyboardAwareScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        keyboardShouldPersistTaps="handled"
        enableOnAndroid
        enableAutomaticScroll={!isIOS}
        extraScrollHeight={0}
        showsVerticalScrollIndicator={false}>
        <View style={styles.contentContainer}>
          <Text style={styles.headerText}>{t('auth.login.subtitle')}</Text>
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>{t('auth.login.email.label')}</Text>
            <TextInput
              style={[
                styles.input,
                isFocused && styles.inputFocused,
                !isLoading && styles.inputEnabled,
              ]}
              value={email}
              onChangeText={handleEmailChange}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              returnKeyType="go"
              onSubmitEditing={handleSubmit}
              editable={!isLoading}
              placeholderTextColor={colors.mediumGray}
            />
            <Button
              label={t('common.next')}
              onPress={handleSubmit}
              isDisabled={!isValidEmail(email)}
              isLoading={isOtpLoading}
            />
          </View>

          <View style={styles.dividerContainer}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>{t('common.or')}</Text>
            <View style={styles.dividerLine} />
          </View>

          <GoogleLoginButton
            onPress={handleGoogleSignIn}
            isLoading={isGoogleLoading}
            isDisabled={isLoading}
          />

          {isIOS && (
            <AppleLoginButton
              onPress={handleAppleSignIn}
              isLoading={isAppleLoading}
              isDisabled={isLoading}
            />
          )}
        </View>
        <View style={styles.bottomContainer}>
          <View style={styles.termsContainer}>
            <Text style={styles.termsText}>
              {t('auth.login.proceedAgree')}{' '}
              <Text
                style={styles.termsLink}
                onPress={() => Linking.openURL(TERMS_AND_CONDITIONS_URL)}>
                {t('auth.login.terms')}
              </Text>{' '}
              {t('auth.login.and')}{' '}
              <Text
                style={styles.termsLink}
                onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}>
                {t('auth.login.privacy')}
              </Text>
              .
            </Text>
          </View>
        </View>
      </KeyboardAwareScrollView>

      <TermsAndAgreementModal
        visible={showTermsModal}
        onAgree={handleAcceptTerms}
      />
    </View>
  );
};
