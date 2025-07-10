import {
  StyleProp,
  TextStyle,
  TouchableOpacityProps,
  ViewStyle,
} from 'react-native';

export interface PrimaryButtonProps extends TouchableOpacityProps {
  label: string;
  onPress: () => void;
  isDisabled?: boolean;
  isLoading?: boolean;
  customContainerStyle?: StyleProp<ViewStyle>;
  customTextStyle?: StyleProp<TextStyle>;
}
