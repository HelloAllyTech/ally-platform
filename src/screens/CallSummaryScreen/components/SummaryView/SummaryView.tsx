import React, {useCallback} from 'react';
import {ScrollView} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import {moderateScale} from 'react-native-size-matters';

import {WINDOW_HEIGHT} from '@/constants/general';

import {styles} from '../../styles';

const windowHeight = WINDOW_HEIGHT;
const maxBorderRadius = 30;

interface SummaryViewProps {
  children: React.ReactNode;
  showAnimation: boolean;
  forceRemountKey: number;
  insets: {top: number};
  onScroll: (isFullyExpanded: boolean) => void;
  scrollViewRef: React.RefObject<ScrollView | null>;
}

export const SummaryView: React.FC<SummaryViewProps> = ({
  children,
  showAnimation,
  forceRemountKey,
  insets,
  onScroll,
  scrollViewRef,
}) => {
  const scrollY = useSharedValue(0);
  const cardHeight = useSharedValue(0);

  const handleScroll = useCallback(
    (event: any) => {
      const {contentOffset, layoutMeasurement, contentSize} = event.nativeEvent;
      scrollY.value = contentOffset.y;
      onScroll(contentOffset.y <= 80);

      // Check if we're near the bottom
      const paddingToBottom = moderateScale(30);
      const isCloseToBottom =
        layoutMeasurement.height + contentOffset.y >=
        contentSize.height - paddingToBottom;
      return !isCloseToBottom;
    },
    [onScroll, scrollY],
  );

  const handleLayout = useCallback(() => {
    cardHeight.value = WINDOW_HEIGHT * 0.8;
  }, [cardHeight]);

  const animatedCardStyle = useAnimatedStyle(() => {
    const newHeight = Math.min(cardHeight.value + scrollY.value, windowHeight);
    const progress =
      (newHeight - cardHeight.value) / (windowHeight - cardHeight.value);
    const borderRadius = withSpring(maxBorderRadius * (1 - progress), {
      damping: 15,
      stiffness: 120,
      mass: 0.5,
    });

    return {
      height: withSpring(newHeight, {
        damping: 15,
        stiffness: 120,
        mass: 0.5,
        velocity: 0.5,
      }),
      borderTopLeftRadius: borderRadius,
      borderTopRightRadius: borderRadius,
    };
  });

  return (
    <Animated.View
      key={forceRemountKey}
      style={[
        styles.card,
        showAnimation && animatedCardStyle,
        {maxHeight: WINDOW_HEIGHT - insets.top},
      ]}>
      <ScrollView
        ref={scrollViewRef}
        onScroll={handleScroll}
        scrollEventThrottle={8}
        onLayout={handleLayout}
        contentContainerStyle={styles.contentContainer}>
        {children}
      </ScrollView>
    </Animated.View>
  );
};
