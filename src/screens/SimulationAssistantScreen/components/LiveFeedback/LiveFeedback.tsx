import React, {useEffect} from 'react';
import {AccessibilityInfo, Text, View} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';

export interface LiveFeedbackProps {
  message: string;
  emoji?: string;
}

export const LiveFeedback: React.FC<LiveFeedbackProps> = ({
  message,
  emoji = '🙂',
}) => {
  const translateY = useSharedValue(96);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.98);

  useEffect(() => {
    // Announce for accessibility as soon as it renders
    AccessibilityInfo.announceForAccessibility?.(message);

    // Smooth slide up with gentle overshoot
    translateY.value = withSequence(
      withTiming(-4, {duration: 480, easing: Easing.out(Easing.cubic)}),
      withSpring(0, {damping: 18, stiffness: 120}),
    );

    // Softer scale pop
    scale.value = withSequence(
      withTiming(1.02, {duration: 260, easing: Easing.out(Easing.cubic)}),
      withTiming(1, {duration: 220, easing: Easing.out(Easing.quad)}),
    );

    // Slower fade in for smoothness
    opacity.value = withTiming(1, {duration: 420});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const containerAnimStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{translateY: translateY.value}, {scale: scale.value}],
  }));

  return (
    <Animated.View style={[styles.container, containerAnimStyle]}>
      <View style={styles.emojiWrapper}>
        <Text style={styles.emoji}>{emoji}</Text>
      </View>
      <Text style={styles.message} numberOfLines={4}>
        {message}
      </Text>
    </Animated.View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    borderRadius: '24@ms',
    shadowColor: colors.black,
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: {width: 0, height: 4},
    elevation: 3,
  },
  emojiWrapper: {
    width: '32@ms',
    height: '32@ms',
    borderRadius: '16@ms',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: '10@ms',
    backgroundColor: colors.creamYellow,
  },
  emoji: {
    fontSize: '18@ms',
  },
  message: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '14@ms',
    color: colors.white,
    flexShrink: 1,
  },
});
