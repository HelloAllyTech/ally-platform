import React from 'react';
import {ActivityIndicator, Text, TouchableOpacity} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, radius, typography} from '@/theme';

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
        <ActivityIndicator color={colors.white} style={styles.loader} />
      ) : (
        <Text style={[styles.buttonText, customTextStyle]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
};

const styles = ScaledSheet.create({
  button: {
    width: '100%',
    backgroundColor: colors.ds.theme.primary,
    paddingVertical: '10@vs',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.full,
  },
  buttonDisabled: {
    backgroundColor: colors.ds.state.disabledContainer,
  },
  buttonLoading: {
    paddingVertical: '10@vs',
  },
  buttonText: {
    ...typography.body.medium,
    color: colors.ds.neutral.white,
  },
  loader: {
    marginVertical: '2.5@ms',
  },
});
