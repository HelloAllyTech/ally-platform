import {StyleProp, TextStyle, ViewStyle} from 'react-native';

export interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  isDisabled?: boolean;
  isLoading?: boolean;
  customContainerStyle?: StyleProp<ViewStyle>;
  customTextStyle?: StyleProp<TextStyle>;
  testID?: string;
}
