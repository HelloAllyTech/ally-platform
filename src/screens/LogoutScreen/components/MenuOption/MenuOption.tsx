import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {fontFamily} from '@/theme';

import type {MenuOptionProps} from './types';

export const MenuOption: React.FC<MenuOptionProps> = ({
  icon,
  text,
  onPress,
  textColor = '#000000',
  textStyle,
  containerStyle,
  gap = 12,
  disabled = false,
}) => {
  return (
    <TouchableOpacity
      style={[styles.option, containerStyle, {gap: ms(gap)}]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}>
      <View style={styles.optionIcon}>{icon}</View>
      <Text style={[styles.optionText, {color: textColor}, textStyle]}>
        {text}
      </Text>
    </TouchableOpacity>
  );
};

const styles = ScaledSheet.create({
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: '16@ms',
  },
  optionIcon: {
    width: '24@ms',
    height: '24@ms',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: ms(14),
    lineHeight: ms(18.2),
    letterSpacing: ms(0.15),
  },
});
