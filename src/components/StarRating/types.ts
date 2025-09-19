import {StyleProp, ViewStyle} from 'react-native';

export interface StarRatingProps {
  rating: number;
  onRatingChange: (rating: number) => void;
  size?: number;
  testID?: string;
  customContainerStyle?: StyleProp<ViewStyle>;
}
