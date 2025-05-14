import React from 'react';
import {Text, TouchableOpacity, ActivityIndicator} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme/colors';
import {typography} from '@/theme/typography';

import type {PrimaryButtonProps} from './types';

export const PrimaryButton: React.FC<PrimaryButtonProps> = ({
  label,
  isDisabled,
  isLoading,
  onPress,
  customContainerStyle,
  customTextStyle,
}) => {
  return (
    <TouchableOpacity
      style={[
        styles.button,
        isDisabled && styles.buttonDisabled,
        isLoading && styles.buttonLoading,
        customContainerStyle,
      ]}
      disabled={isDisabled || isLoading}
      activeOpacity={0.8}
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
