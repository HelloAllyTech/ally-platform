import {StyleProp, TextStyle, ViewStyle} from 'react-native';

export interface FeedbackPopupProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (
    rating: number,
    feedback: {issues: string[]; comment: string},
  ) => void;
  customContainerStyle?: StyleProp<ViewStyle>;
  customTitle?: string;
  note?: string;
  placeholder?: string;
  showChips?: boolean;
  customTitleStyle?: StyleProp<TextStyle>;
  customTextAreaStyle?: StyleProp<ViewStyle>;
  customButtonStyle?: StyleProp<ViewStyle>;
  testID?: string;
}
