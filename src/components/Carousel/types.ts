import {
  ImageSourcePropType,
  StyleProp,
  TextStyle,
  ViewStyle,
} from 'react-native';
import type {ICarouselInstance} from 'react-native-reanimated-carousel';

import {CarouselVariant} from '@/constants';
import {TranslationType} from '@/localization/locales/type';

export interface CarouselItem {
  image: ImageSourcePropType;
  textKey: TranslationType;
}

export interface CarouselProps {
  data: CarouselItem[];
  renderItem: (item: CarouselItem, index: number) => React.ReactElement;
  width?: number;
  height?: number;
  itemWidth?: number;
  itemHeight?: number;
  autoPlay?: boolean;
  autoPlayInterval?: number;
  loop?: boolean;
  enabled?: boolean;
  showPagination?: boolean;
  paginationStyle?: StyleProp<ViewStyle>;
  paginationDotStyle?: StyleProp<ViewStyle>;
  paginationActiveDotStyle?: StyleProp<ViewStyle>;
  showNavigation?: boolean;
  navigationStyle?: StyleProp<ViewStyle>;
  navigationButtonStyle?: StyleProp<ViewStyle>;
  navigationButtonTextStyle?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  onSnapToItem?: (index: number) => void;
  onScrollBegin?: () => void;
  onScrollEnd?: () => void;
  mode?: 'parallax' | 'horizontal-stack' | 'vertical-stack';
  accessibilityLabel?: string;
  testID?: string;
}

export interface CarouselRef {
  scrollTo: (index: number, animated?: boolean) => void;
  scrollToNext: (animated?: boolean) => void;
  scrollToPrev: (animated?: boolean) => void;
  getCurrentIndex: () => number;
  getCarouselInstance: () => ICarouselInstance | null;
}

export interface PaginationProps {
  totalItems: number;
  currentIndex: number;
  style?: StyleProp<ViewStyle>;
  inactiveDotStyle?: StyleProp<ViewStyle>;
  activeDotStyle?: StyleProp<ViewStyle>;
}

export interface NavigationProps {
  onPrev: () => void;
  onNext: () => void;
  currentIndex: number;
  totalItems: number;
  style?: StyleProp<ViewStyle>;
  buttonStyle?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export interface SecurityCarouselProps {
  variant?: CarouselVariant;
}

export type CarouselConfig = {
  width: number;
  isBlurView: boolean;
  paginationActiveDotStyle: ViewStyle;
  imageContainerCustomStyle?: ViewStyle;
  titleCustomStyle?: TextStyle;
};
