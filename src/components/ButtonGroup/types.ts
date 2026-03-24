import {StyleProp, TextStyle, ViewStyle} from 'react-native';

export type ButtonVariant = 'default' | 'active' | 'destructive';

export interface ButtonOption {
  id: string;
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: ButtonVariant;
  testID?: string;
}

export interface ButtonGroupProps {
  buttons: ButtonOption[];
  customContainerStyle?: StyleProp<ViewStyle>;
  customButtonStyle?: StyleProp<ViewStyle>;
  customButtonTextStyle?: StyleProp<TextStyle>;
  testID?: string;
}

export interface ButtonItemProps {
  button: ButtonOption;
  customStyle?: StyleProp<ViewStyle>;
  customTextStyle?: StyleProp<TextStyle>;
  isLast?: boolean;
}

export interface CollapsibleButtonGroupProps extends ButtonGroupProps {
  isMaximized: boolean;
  onToggleMaximized: () => void;
  chevronColor?: string;
  customToggleContainerStyle?: StyleProp<ViewStyle>;
  headerContent?: React.ReactNode;
  children?: React.ReactNode;
}
