import React from 'react';
import {Text, TouchableOpacity} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {DEFAULT_HIT_SLOP} from '@/constants';
import {colors, fontFamily} from '@/theme';

import type {ButtonItemProps} from './types';

const VARIANT_STYLES = {
  default: {
    button: null,
    text: null,
  },
  active: {
    button: {backgroundColor: colors.white},
    text: {color: colors.darkGray5},
  },
  destructive: {
    button: {backgroundColor: colors.darkGray10},
    text: {color: colors.ds.neutral.white},
  },
};

export const ButtonItem: React.FC<ButtonItemProps> = ({
  button,
  customStyle,
  customTextStyle,
  isLast,
}) => {
  const {icon, label, onPress, disabled, variant = 'default', testID} = button;
  const variantStyle = VARIANT_STYLES[variant];

  return (
    <TouchableOpacity
      style={[
        styles.button,
        variantStyle.button,
        disabled && styles.buttonDisabled,
        isLast && styles.buttonLast,
        customStyle,
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      hitSlop={DEFAULT_HIT_SLOP}
      testID={testID}>
      {icon}
      <Text style={[styles.buttonText, variantStyle.text, customTextStyle]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
};

const styles = ScaledSheet.create({
  button: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: '16@vs',
    backgroundColor: colors.darkGray10,
    gap: '10@s',
    borderRadius: '8@ms',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonLast: {
    marginBottom: '8@mvs',
  },
  buttonText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '14@ms',
    color: colors.ds.neutral.white,
  },
});
