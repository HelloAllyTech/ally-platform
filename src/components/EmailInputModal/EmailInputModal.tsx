import React, {useCallback, useState} from 'react';
import {
  Animated,
  Keyboard,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {PrimaryButton} from '@/components';
import {useTranslate} from '@/hooks';
import {useSendOtpMutation} from '@/services';
import {colors, fontFamily, typography} from '@/theme';
import {getErrorMessage} from '@/utils';

interface EmailInputModalProps {
  visible: boolean;
  onClose: () => void;
  onEmailSubmit: (email: string) => void;
}

export const EmailInputModal: React.FC<EmailInputModalProps> = ({
  visible,
  onClose,
  onEmailSubmit,
}) => {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const {t} = useTranslate();

  const [sendOtp, {isLoading: isSendingOtp}] = useSendOtpMutation();

  const isValidEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleEmailChange = useCallback((text: string) => {
    setEmail(text);
    setError('');
  }, []);

  const handleSubmit = async () => {
    if (!email.trim()) {
      setError(t('Simulations.pleaseEnterEmail'));
      return;
    }

    if (!isValidEmail(email.trim())) {
      setError(t('Simulations.pleaseEnterValidEmail'));
      return;
    }

    try {
      setIsSubmitting(true);
      await sendOtp({email: email.trim()});
      onEmailSubmit(email.trim());
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = useCallback(() => {
    setEmail('');
    setError('');
    onClose();
  }, [onClose]);

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={() => {
          Keyboard.dismiss();
          handleClose();
        }}
      />
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <Animated.View style={styles.modalContainer}>
          <View style={styles.scrollContent}>
            <View style={styles.header}>
              <Text style={styles.title}>
                {t('Simulations.enterYourEmail')}
              </Text>
              <TouchableOpacity
                onPress={handleClose}
                style={styles.closeButton}>
                <Text style={styles.closeButtonText}>×</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.description}>
              {t('Simulations.emailDescription')}
            </Text>

            <View style={styles.inputContainer}>
              <TextInput
                style={[styles.input, error && styles.inputError]}
                placeholder={t('Simulations.emailPlaceholder')}
                placeholderTextColor={colors.darkGray8}
                value={email}
                onChangeText={handleEmailChange}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
              />
            </View>

            {error ? (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.buttonContainer}>
              <PrimaryButton
                label={t('Simulations.continue')}
                onPress={handleSubmit}
                isDisabled={!email.trim() || isSubmitting}
                isLoading={isSubmitting || isSendingOtp}
              />
            </View>
          </View>
        </Animated.View>
      </TouchableWithoutFeedback>
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
  backdrop: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'transparent',
  },
  modalContainer: {
    backgroundColor: colors.white,
    borderRadius: '12@ms',
    maxWidth: '90%',
    maxHeight: '80%',
    width: '320@ms',
    elevation: 5,
    shadowColor: colors.black,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
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
  inputContainer: {
    marginBottom: '16@mvs',
  },
  input: {
    borderWidth: 1,
    borderColor: colors.lightGray6,
    borderRadius: '8@ms',
    paddingHorizontal: '16@ms',
    paddingVertical: '12@mvs',
    fontSize: '16@ms',
    fontFamily: fontFamily.IBM_PLEX_SERIF.REGULAR.fontFamily,
    color: colors.black,
    backgroundColor: colors.white,
  },
  inputError: {
    borderColor: colors.brightRed,
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
  buttonContainer: {
    marginTop: '8@mvs',
  },
});
