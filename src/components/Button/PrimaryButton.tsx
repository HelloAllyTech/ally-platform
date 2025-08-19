import React from 'react';
import {ActivityIndicator, Text, TouchableOpacity} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, typography} from '@/theme';

import type {PrimaryButtonProps} from './types';

export const PrimaryButton: React.FC<PrimaryButtonProps> = ({
  label,
  isDisabled,
  isLoading,
  onPress,
  customContainerStyle,
  customTextStyle,
  ...rest
}) => {
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      {...rest}
      style={[
        styles.button,
        isDisabled && styles.buttonDisabled,
        isLoading && styles.buttonLoading,
        customContainerStyle,
      ]}
      disabled={isDisabled || isLoading}
      onPress={onPress}>
      {isLoading ? (
        <ActivityIndicator color={colors.white} />
      ) : (
        <Text style={[styles.buttonText, customTextStyle]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
};

const styles = ScaledSheet.create({
  button: {
    width: '100%',
    backgroundColor: colors.azureBlue,
    paddingVertical: '11@vs',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: '24@ms',
  },
  buttonDisabled: {
    backgroundColor: colors.ashGray,
  },
  buttonLoading: {
    paddingVertical: '13@vs',
  },
  buttonText: {
    ...typography.body.large,
    color: colors.white,
  },
});
