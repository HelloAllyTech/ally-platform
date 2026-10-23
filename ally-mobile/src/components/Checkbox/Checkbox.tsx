import React from 'react';
import {TouchableOpacity, View, ViewStyle} from 'react-native';

import {CheckWhiteIcon} from '@/assets';

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
        {checked && <CheckWhiteIcon />}
      </View>
    </TouchableOpacity>
  );
};
