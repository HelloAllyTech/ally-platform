import {TextStyle, ViewStyle} from 'react-native';

export interface MenuOptionProps {
  icon: React.ReactNode;
  text: string;
  onPress: () => void;
  textColor?: string;
  textStyle?: TextStyle;
  containerStyle?: ViewStyle;
  gap?: number;
  disabled?: boolean;
}
