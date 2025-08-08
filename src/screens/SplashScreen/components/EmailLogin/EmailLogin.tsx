import React, {useCallback, useEffect, useState} from 'react';
import {SerializedError} from '@reduxjs/toolkit';
import {FetchBaseQueryError} from '@reduxjs/toolkit/query';
import {
  Alert,
  Keyboard,
  Linking,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';

import {PrimaryButton} from '@/components';
import {isValidEmail} from '@/constants/general';
import {useTranslate} from '@/hooks';
import {useGenerateOtpMutation} from '@/services/authApi';
import {colors} from '@/theme/colors';
import {getErrorMessage} from '@/utils/error';

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
      const message = getErrorMessage(err);
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

  const dismissKeyboard = useCallback(() => {
    Keyboard.dismiss();
    setIsFocused(false);
  }, []);

  return (
    <TouchableWithoutFeedback onPress={dismissKeyboard}>
      <View style={styles.container}>
        <View style={styles.contentContainer}>
          <Text style={styles.headerText}>
            {t('SplashScreen.enterYourEmail')}
          </Text>
          <View style={styles.inputContainer}>
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
              placeholder={t('SplashScreen.emailPlaceholder')}
              editable={!isLoading}
              placeholderTextColor={colors.mediumGray}
            />
          </View>
        </View>

        <View style={styles.bottomContainer}>
          <View style={styles.termsContainer}>
            <Text style={styles.termsText}>
              {t('SplashScreen.byTappingNext')}{' '}
              <Text
                style={styles.termsLink}
                onPress={() => Linking.openURL('https://example.com/terms')}>
                {t('SplashScreen.termsAndConditions')}
              </Text>{' '}
              {t('SplashScreen.andAcknowledge')}{' '}
              <Text
                style={styles.termsLink}
                onPress={() => Linking.openURL('https://example.com/privacy')}>
                {t('SplashScreen.privacyPolicy')}
              </Text>
              .
            </Text>
          </View>

          <PrimaryButton
            label={t('SplashScreen.next')}
            onPress={handleSubmit}
            isDisabled={!isValidEmail(email)}
            isLoading={isLoading}
          />
        </View>
      </View>
    </TouchableWithoutFeedback>
  );
};
