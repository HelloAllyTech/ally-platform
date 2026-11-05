import React from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';

import {Chip} from './Chip';
import type {ChipGroupProps} from './types';

export const ChipGroup: React.FC<ChipGroupProps> = ({
  options,
  selectedValues,
  onSelectionChange,
  title,
  customContainerStyle,
  customChipStyle,
  customChipTextStyle,
  customTitleStyle,
}) => {
  const handleChipPress = (value: string) => {
    const newSelectedValues = selectedValues.includes(value)
      ? selectedValues.filter(v => v !== value)
      : [...selectedValues, value];

    onSelectionChange(newSelectedValues);
  };

  return (
    <View style={[styles.container, customContainerStyle]}>
      {title && <Text style={[styles.title, customTitleStyle]}>{title}</Text>}
      <View style={styles.chipContainer}>
        {options.map(option => (
          <Chip
            key={option.value}
            option={option}
            isSelected={selectedValues.includes(option.value)}
            onPress={() => handleChipPress(option.value)}
            customStyle={customChipStyle}
            customTextStyle={customChipTextStyle}
          />
        ))}
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    width: '100%',
    marginBottom: '6@vs',
  },
  title: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '16@ms',
    color: colors.black,
    marginBottom: '14@vs',
    textAlign: 'center',
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
});
