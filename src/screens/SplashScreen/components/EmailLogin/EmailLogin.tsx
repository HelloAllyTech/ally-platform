import React, {useCallback, useEffect, useState} from 'react';
import {SerializedError} from '@reduxjs/toolkit';
import {FetchBaseQueryError} from '@reduxjs/toolkit/query';
import {Alert, Linking, Text, TextInput, View} from 'react-native';
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scroll-view';

import {PrimaryButton} from '@/components';
import {
  isIOS,
  PRIVACY_POLICY_URL,
  TERMS_AND_CONDITIONS_URL,
} from '@/constants/general';
import {useTranslate} from '@/hooks';
import {useGenerateOtpMutation} from '@/services/authApi';
import {colors} from '@/theme';
import {getErrorDetails, isValidEmail} from '@/utils';

import {styles} from './styles';
import type {EmailLoginProps} from './types';

export const EmailLogin: React.FC<EmailLoginProps> = ({
  onOtpGenerationSuccess,
}) => {
  const [email, setEmail] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [generateOtp, {isLoading, isSuccess, isError, error, data}] =
    useGenerateOtpMutation();
  const {t} = useTranslate();

  const handleOtpError = useCallback(
    (err: FetchBaseQueryError | SerializedError) => {
      const message = getErrorDetails(err).message;
      Alert.alert(
        'Failed to Send OTP',
        message === 'Network Error'
          ? 'Please check your internet connection and try again.'
          : message,
      );
    },
    [],
  );

  // Handle success
  useEffect(() => {
    if (isSuccess && data) {
      onOtpGenerationSuccess(email);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, data, email]);

  // Handle error
  useEffect(() => {
    if (isError && error) {
      handleOtpError(error);
    }
  }, [isError, error, handleOtpError]);

  const handleEmailChange = useCallback((text: string) => {
    setEmail(text.trim().toLowerCase());
  }, []);

  const handleSubmit = useCallback(async () => {
    if (isValidEmail(email)) {
      await generateOtp({email});
    }
  }, [email, generateOtp]);

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
          <Text style={styles.headerText}>
            {t('SplashScreen.enterYourEmail')}
          </Text>
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>{t('SplashScreen.email')}</Text>
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
          </View>
        </View>
      </KeyboardAwareScrollView>
      <View style={styles.bottomContainer}>
        <View style={styles.termsContainer}>
          <Text style={styles.termsText}>
            {t('SplashScreen.byTappingNext')}{' '}
            <Text
              style={styles.termsLink}
              onPress={() => Linking.openURL(TERMS_AND_CONDITIONS_URL)}>
              {t('SplashScreen.termsAndConditions')}
            </Text>{' '}
            {t('SplashScreen.andAcknowledge')}{' '}
            <Text
              style={styles.termsLink}
              onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}>
              {t('SplashScreen.privacyPolicy')}
            </Text>
            .
          </Text>
        </View>

        <PrimaryButton
          label={t('Common.next')}
          onPress={handleSubmit}
          isDisabled={!isValidEmail(email)}
          isLoading={isLoading}
        />
      </View>
    </View>
  );
};
