import {StyleProp, TextStyle, ViewStyle} from 'react-native';

export interface FeedbackValue {
  rating?: number;
  tags?: string[];
  comment?: string;
}

export interface FeedbackSubmission {
  rating: number;
  issues: string[];
  comment: string;
  tags: string[];
}

export interface FeedbackPopupProps {
  visible: boolean;
  onClose: () => void;
  initialFeedback?: FeedbackValue;
  onSubmit: (feedback: FeedbackSubmission) => void;
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
