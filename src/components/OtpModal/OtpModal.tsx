import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Alert, Text, TouchableOpacity, View} from 'react-native';
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scroll-view';
import {ScaledSheet} from 'react-native-size-matters';

import {PrimaryButton} from '@/components/Button/PrimaryButton';
import {AsyncStorageKeys} from '@/constants/asyncStorage';
import {useTranslate} from '@/hooks';
import {
  useSendOtpMutation,
  useVerifyOtpMutation,
} from '@/services/simulationsApi';
import {colors, fontFamily, typography} from '@/theme';
import {setItem} from '@/utils/asyncStorage';
import {getErrorMessage} from '@/utils/error';

import {
  OtpInput,
  OtpInputRef,
} from '../../screens/SplashScreen/components/OtpInput/OtpInput';

interface OtpModalProps {
  visible: boolean;
  onClose: () => void;
  email: string;
  onOtpVerificationSuccess: () => void;
}

const DEFAULT_OTP = ['', '', '', ''];

export const OtpModal: React.FC<OtpModalProps> = ({
  visible,
  onClose,
  email,
  onOtpVerificationSuccess,
}) => {
  const [otpValue, setOtpValue] = useState(DEFAULT_OTP);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(30);
  const [isResendDisabled, setIsResendDisabled] = useState(true);
  const [isProcessingSuccess, setIsProcessingSuccess] = useState(false);
  const otpInputRef = useRef<OtpInputRef>(null);
  const {t} = useTranslate();

  const [verifyOtp, {isLoading: isVerifying, isError, error: apiError}] =
    useVerifyOtpMutation();
  const [sendOtp, {isLoading: isResending}] = useSendOtpMutation();

  const isOtpComplete = otpValue.every(v => v !== '');
  const otp = otpValue.join('');

  // Countdown timer for resend
  useEffect(() => {
    if (countdown === 0) {
      setIsResendDisabled(false);
      return;
    }
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  // Handle OTP verification error
  useEffect(() => {
    if (isError && apiError) {
      setError(getErrorMessage(apiError));
    }
  }, [isError, apiError]);

  const handleOtpChange = useCallback((newValue: string[]) => {
    setOtpValue(newValue);
    setError('');
  }, []);

  const handleSubmit = async () => {
    if (isOtpComplete) {
      const response = await verifyOtp({email, otp});
      if (response.data?.tokens?.access_token) {
        setIsProcessingSuccess(true);
        try {
          await setItem(
            AsyncStorageKeys.LEARN_ACCESS_TOKEN,
            response.data.tokens.access_token as string,
          );
          onOtpVerificationSuccess();
        } finally {
          setIsProcessingSuccess(false);
        }
      }
    }
  };

  const resetOtpState = useCallback(() => {
    setOtpValue(DEFAULT_OTP);
    setError('');
    setCountdown(30);
    setIsResendDisabled(true);
  }, []);

  const handleResendOtp = async () => {
    try {
      await sendOtp({email});
      resetOtpState();
      otpInputRef.current?.focusFirst();
    } catch (err) {
      Alert.alert('Error', getErrorMessage(err));
    }
  };

  const handleClose = useCallback(() => {
    setOtpValue(DEFAULT_OTP);
    setError('');
    onClose();
  }, [onClose]);

  if (!visible) return null;

  const renderProcessingOverlay = () => {
    return (
      <View style={styles.processingOverlay}>
        <View style={styles.processingContainer}>
          <Text style={styles.processingText}>Creating room...</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.overlay}>
      <View style={styles.modalContainer}>
        <KeyboardAwareScrollView
          contentContainerStyle={styles.scrollContent}
          enableOnAndroid
          extraScrollHeight={0}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.title}>{t('Simulations.verifyOtp')}</Text>
            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>×</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.description}>
            {t('Simulations.enterTheCodeSentTo')}
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
              {t('Simulations.didNotReceiveTheCode')}
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
                {t('Simulations.resend')}{' '}
                {countdown > 0 ? `(${countdown}s)` : ''}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.buttonContainer}>
            <PrimaryButton
              label={t('Simulations.verifyOtp')}
              onPress={handleSubmit}
              isDisabled={!isOtpComplete}
              isLoading={isVerifying}
            />
          </View>
        </KeyboardAwareScrollView>
      </View>

      {isProcessingSuccess && renderProcessingOverlay()}
    </View>
  );
};

const styles = ScaledSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(19, 19, 19, 0.37)',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    left: 0,
    zIndex: 9999,
  },
  modalContainer: {
    backgroundColor: colors.white,
    borderRadius: '12@ms',
    maxWidth: '90%',
    maxHeight: '80%',
    width: '320@ms',
  },
  scrollContent: {
    padding: '20@ms',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16@mvs',
  },
  title: {
    ...typography.body.large,
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.black,
    flex: 1,
  },
  closeButton: {
    width: '24@ms',
    height: '24@ms',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: '20@ms',
    color: colors.darkGray8,
    fontWeight: 'bold',
  },
  description: {
    ...typography.body.medium,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.charcoal2,
    textAlign: 'center',
    marginBottom: '24@mvs',
  },
  emailText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.black,
  },
  otpContainer: {
    marginBottom: '16@mvs',
  },
  errorContainer: {
    marginBottom: '16@mvs',
    paddingHorizontal: '8@ms',
  },
  errorText: {
    ...typography.body.small,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.brightRed,
    textAlign: 'center',
  },
  resendContainer: {
    marginBottom: '24@mvs',
    alignItems: 'center',
  },
  helperText: {
    ...typography.body.small,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.darkGray8,
    marginBottom: '8@mvs',
  },
  resendButton: {
    paddingVertical: '4@mvs',
    paddingHorizontal: '8@ms',
  },
  resendButtonText: {
    ...typography.body.small,
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.brightBlue,
  },
  resendButtonDisabled: {
    color: colors.lightGray6,
  },
  buttonContainer: {
    marginTop: '8@mvs',
  },
  processingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10000,
  },
  processingContainer: {
    backgroundColor: colors.white,
    paddingHorizontal: '24@ms',
    paddingVertical: '16@mvs',
    borderRadius: '8@ms',
    alignItems: 'center',
  },
  processingText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.black,
    fontSize: '16@ms',
  },
});
