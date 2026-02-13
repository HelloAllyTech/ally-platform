import React from 'react';
import {ActivityIndicator, Text, TouchableOpacity} from 'react-native';

import {colors} from '@/theme';

import {styles} from './styles';
import type {ButtonProps} from './types';

export const VARIANT_STYLES = {
  primary: {
    button: {backgroundColor: colors.ds.theme.primary},
    text: {color: colors.ds.neutral.white},
  },
  secondary: {
    button: {
      backgroundColor: colors.ds.theme.onSecondary,
      borderWidth: 1,
      borderColor: colors.ds.stroke.primary,
    },
    text: {color: colors.ds.typography.highEmphasis},
  },
  destructive: {
    button: {
      backgroundColor: colors.ds.red[400],
    },
    text: {color: colors.ds.neutral.white},
  },
};

export const SIZE_STYLES = {
  sm: styles.sizeSm,
  md: styles.sizeMd,
  lg: styles.sizeLg,
};

export const Button: React.FC<ButtonProps> = ({
  label,
  isDisabled,
  isLoading,
  onPress,
  variant = 'primary',
  buttonSize = 'md',
  customContainerStyle,
  customTextStyle,
  IconLeft,
  IconRight,
  iconSize,
  iconColor,
  ...rest
}) => {
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      {...rest}
      style={[
        styles.button,
        VARIANT_STYLES[variant].button,
        SIZE_STYLES[buttonSize],
        isDisabled && styles.buttonDisabled,
        isLoading && styles.buttonLoading,
        customContainerStyle,
      ]}
      disabled={isDisabled || isLoading}
      onPress={onPress}>
      {isLoading ? (
        <ActivityIndicator
          color={VARIANT_STYLES[variant].text.color}
          style={styles.loader}
        />
      ) : (
        <>
          {IconLeft && (
            <IconLeft width={iconSize} height={iconSize} color={iconColor} />
          )}
          <Text
            style={[
              VARIANT_STYLES[variant].text,
              styles.buttonText,
              customTextStyle,
            ]}>
            {label}
          </Text>
          {IconRight && (
            <IconRight width={iconSize} height={iconSize} color={iconColor} />
          )}
        </>
      )}
    </TouchableOpacity>
  );
};
