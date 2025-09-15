import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';

import type {ChipGroupProps, ChipProps} from './types';

const Chip: React.FC<ChipProps> = ({
  option,
  isSelected,
  onPress,
  customStyle,
  customTextStyle,
  testID,
}) => {
  return (
    <TouchableOpacity
      style={[styles.chip, isSelected && styles.chipSelected, customStyle]}
      onPress={onPress}
      activeOpacity={0.7}
      testID={`${testID}-chip-${option.id}`}>
      <Text
        style={[
          styles.chipText,
          isSelected && styles.chipTextSelected,
          customTextStyle,
        ]}>
        {option.label}
      </Text>
    </TouchableOpacity>
  );
};

export const ChipGroup: React.FC<ChipGroupProps> = ({
  options,
  selectedValues,
  onSelectionChange,
  title,
  customContainerStyle,
  customChipStyle,
  customChipTextStyle,
  customTitleStyle,
  testID,
}) => {
  const handleChipPress = (value: string) => {
    const newSelectedValues = selectedValues.includes(value)
      ? selectedValues.filter(v => v !== value)
      : [...selectedValues, value];

    onSelectionChange(newSelectedValues);
  };

  return (
    <View style={[styles.container, customContainerStyle]} testID={testID}>
      {title && <Text style={[styles.title, customTitleStyle]}>{title}</Text>}
      <View style={styles.chipContainer}>
        {options.map(option => (
          <Chip
            key={option.id}
            option={option}
            isSelected={selectedValues.includes(option.value)}
            onPress={() => handleChipPress(option.value)}
            customStyle={customChipStyle}
            customTextStyle={customChipTextStyle}
            testID={testID}
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
