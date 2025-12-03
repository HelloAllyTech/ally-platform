import React from 'react';
import {TouchableOpacity, View, ViewStyle} from 'react-native';

import {TickIcon} from '@/assets';
import {colors} from '@/theme';

import {styles} from './styles';

export interface CheckboxProps {
  checked: boolean;
  onPress: () => void;
  disabled?: boolean;
  style?: ViewStyle;
  testID?: string;
}

export const Checkbox: React.FC<CheckboxProps> = ({
  checked,
  onPress,
  disabled = false,
  style,
  testID,
}) => {
  return (
    <TouchableOpacity
      style={[styles.container, style]}
      activeOpacity={0.7}
      onPress={onPress}
      disabled={disabled}
      testID={testID}>
      <View
        style={[
          styles.checkbox,
          checked && styles.checkboxChecked,
          disabled && styles.checkboxDisabled,
        ]}>
        {checked && <TickIcon width={12} height={12} color={colors.white} />}
      </View>
    </TouchableOpacity>
  );
};
