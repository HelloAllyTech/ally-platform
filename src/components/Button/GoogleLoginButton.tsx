import React from 'react';
import {ActivityIndicator, Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {GoogleIcon} from '@/assets';
import {useTranslate} from '@/hooks/useTranslate';
import {colors, fontFamily, radius, typography} from '@/theme';

import type {ButtonProps} from './types';

interface GoogleLoginButtonProps extends Omit<ButtonProps, 'label'> {
  label?: string;
}

export const GoogleLoginButton: React.FC<GoogleLoginButtonProps> = ({
  label,
  isDisabled,
  isLoading,
  onPress,
  ...rest
}) => {
  const {t} = useTranslate();
  const buttonLabel = label ?? t('auth.login.google.button');
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      {...rest}
      style={[
        styles.button,
        isDisabled && styles.buttonDisabled,
        isLoading && styles.buttonLoading,
      ]}
      disabled={isDisabled || isLoading}
      onPress={onPress}>
      {isLoading ? (
        <ActivityIndicator
          color={colors.ds.neutral.black}
          style={styles.loader}
        />
      ) : (
        <View style={styles.contentContainer}>
          <GoogleIcon />
          <Text style={styles.buttonText}>{buttonLabel}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = ScaledSheet.create({
  button: {
    width: '100%',
    backgroundColor: colors.ds.neutral.white,
    paddingVertical: '11@vs',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.ds.stroke.primary,
    marginBottom: '10@vs',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonLoading: {
    paddingVertical: '10@vs',
  },
  contentContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.medium,
    color: colors.ds.neutral.black,
    fontWeight: 'semibold',
    marginLeft: '8@ms',
  },
  loader: {
    marginVertical: '2.5@ms',
  },
});
