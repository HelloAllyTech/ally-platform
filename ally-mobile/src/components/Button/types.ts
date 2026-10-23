import {ComponentType} from 'react';
import {StyleProp, TextStyle, ViewStyle} from 'react-native';
import {SvgProps} from 'react-native-svg';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  isDisabled?: boolean;
  isLoading?: boolean;
  customContainerStyle?: StyleProp<ViewStyle>;
  customTextStyle?: StyleProp<TextStyle>;
  activeOpacity?: number;
  testID?: string;
  variant?: ButtonVariant;
  buttonSize?: ButtonSize;
  IconLeft?: ComponentType<SvgProps>;
  IconRight?: ComponentType<SvgProps>;
  iconSize?: number;
  iconColor?: string;
}
