import React from 'react';
import {useTranslation} from 'react-i18next';
import {Text, TouchableOpacity} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';

import type {ChipProps} from './types';

export const Chip: React.FC<ChipProps> = ({
  option,
  isSelected,
  onPress,
  customStyle,
  customTextStyle,
}) => {
  const {t} = useTranslation();

  return (
    <TouchableOpacity
      style={[styles.chip, isSelected && styles.chipSelected, customStyle]}
      onPress={onPress}
      activeOpacity={0.7}>
      <Text
        style={[
          styles.chipText,
          isSelected && styles.chipTextSelected,
          customTextStyle,
        ]}>
        {t(option.label)}
      </Text>
    </TouchableOpacity>
  );
};

const styles = ScaledSheet.create({
  chip: {
    paddingHorizontal: '12@ms',
    paddingVertical: '5@vs',
    borderRadius: '20@ms',
    borderWidth: 1,
    borderColor: colors.lightGray4,
    backgroundColor: colors.white,
    marginHorizontal: '4@ms',
    marginVertical: '4@vs',
  },
  chipSelected: {
    backgroundColor: colors.azureBlue,
    borderColor: colors.azureBlue,
  },
  chipText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.lightGray3,
    textAlign: 'center',
  },
  chipTextSelected: {
    color: colors.white,
    fontWeight: '500',
  },
});
