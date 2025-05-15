import React, {useCallback, useEffect, useState} from 'react';
import {SerializedError} from '@reduxjs/toolkit';
import {FetchBaseQueryError} from '@reduxjs/toolkit/query';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';

import {PrimaryButton} from '@/components';
import {isIOS} from '@/constants/general';
import useTranslate from '@/hooks/useTranslate';
import {useGenerateOtpMutation} from '@/services/authApi';
import {colors} from '@/theme/colors';
import {getErrorMessage} from '@/utils/error';
import {formatPhoneNumberForInput} from '@/utils/phone';

import {styles} from './styles';
import type {PhoneLoginProps} from './types';

export const PhoneLogin: React.FC<PhoneLoginProps> = ({
  onOtpGenerationSuccess,
}) => {
  const [phoneNumber, setPhoneNumber] = useState('');
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
      onOtpGenerationSuccess(`+91${phoneNumber}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, data, phoneNumber]);

  // Handle error
  useEffect(() => {
    if (isError && error) {
      handleOtpError(error);
    }
  }, [isError, error, handleOtpError]);

  const handlePhoneChange = useCallback((text: string) => {
    // Remove any non-numeric characters
    const cleaned = text.replace(/\D/g, '');
    if (cleaned.length <= 10) {
      setPhoneNumber(cleaned);
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (phoneNumber.length === 10) {
      await generateOtp({phone: `+91${phoneNumber}`});
    }
  }, [phoneNumber, generateOtp]);

  const formattedPhoneNumberForInput = formatPhoneNumberForInput(phoneNumber);

  const dismissKeyboard = useCallback(() => {
    Keyboard.dismiss();
    setIsFocused(false);
  }, []);

  return (
    <KeyboardAvoidingView
      behavior={isIOS ? 'padding' : 'height'}
      style={styles.container}>
      <TouchableWithoutFeedback onPress={dismissKeyboard}>
        <View style={styles.container}>
          <View style={styles.contentContainer}>
            <Text style={styles.headerText}>
              {t('SplashScreen.enterYourPhoneNumber')}
            </Text>
            <View style={styles.inputContainer}>
              <View style={styles.countryCode}>
                <Text style={styles.countryCodeText}>+91</Text>
              </View>
              <TextInput
                style={[
                  styles.input,
                  isFocused && styles.inputFocused,
                  !isLoading && styles.inputEnabled,
                ]}
                value={formattedPhoneNumberForInput}
                onChangeText={handlePhoneChange}
                keyboardType="numeric"
                maxLength={11} // 10 digits + 1 space
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                placeholder="Enter phone number"
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
                  onPress={() =>
                    Linking.openURL('https://example.com/privacy')
                  }>
                  {t('SplashScreen.privacyPolicy')}
                </Text>
                .
              </Text>
            </View>

            <PrimaryButton
              label={t('SplashScreen.next')}
              onPress={handleSubmit}
              isDisabled={phoneNumber.length !== 10}
              isLoading={isLoading}
            />
          </View>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
};
