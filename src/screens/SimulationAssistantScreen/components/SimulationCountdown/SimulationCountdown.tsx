import React, {useEffect} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';

export interface SimulationCountdownProps {
  step: 3 | 2 | 1;
  label: string;
}

// Fixed 3-2-1 overlay synchronized with the start-simulation audio cue — both
// begin the moment SimulationAssistantScreen mounts (see the screen's
// countdownStep state/effect). One second per number. Full-screen and
// opaque so nothing underneath — the loader, or on a fast agent join, the
// live call UI — is visible or reachable until it finishes.
export const SimulationCountdown: React.FC<SimulationCountdownProps> = ({
  step,
  label,
}) => {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.6);

  useEffect(() => {
    opacity.value = 0;
    scale.value = 0.6;
    opacity.value = withTiming(1, {
      duration: 250,
      easing: Easing.out(Easing.cubic),
    });
    scale.value = withTiming(1, {
      duration: 250,
      easing: Easing.out(Easing.cubic),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const numberAnimStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{scale: scale.value}],
  }));

  return (
    <View
      style={styles.overlay}
      testID="simulation-countdown"
      accessible
      accessibilityLiveRegion="assertive">
      <Animated.View style={[styles.circle, numberAnimStyle]}>
        <Text style={styles.number}>{step}</Text>
      </Animated.View>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
};

const styles = ScaledSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    backgroundColor: colors.ds.grey[950],
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16@vs',
  },
  circle: {
    width: '120@ms',
    height: '120@ms',
    borderRadius: '60@ms',
    borderWidth: 2,
    borderColor: '#57f646',
    alignItems: 'center',
    justifyContent: 'center',
  },
  number: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
    fontSize: '48@ms',
    color: colors.white,
  },
  label: {
    ...fontFamily.ROBOTO.REGULAR,
    fontSize: '14@ms',
    color: colors.lightGray3,
    textAlign: 'center',
  },
});
