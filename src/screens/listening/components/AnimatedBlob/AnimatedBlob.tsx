import React from 'react';
import LottieView, {AnimationObject} from 'lottie-react-native';
import {View} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {ScaledSheet} from 'react-native-size-matters';

import blobAnimation from '@/assets/animations/blobAnimation.json';

import {PlayPauseOverlay} from '../PlayPauseOverlay';

interface AnimatedBlobProps {
  isExpanded: boolean;
  intensity: number;
  isCallPaused: boolean;
  onPlayPauseCallPress: () => void;
}

const SMOOTHING_FACTOR = 0.3;

const AnimatedLottieView = Animated.createAnimatedComponent(LottieView);

export const AnimatedBlob: React.FC<AnimatedBlobProps> = ({
  isExpanded,
  intensity,
  isCallPaused,
  onPlayPauseCallPress,
}) => {
  // Use shared value for smooth animations
  const currentIntensity = useSharedValue(0);

  // Smooth out intensity changes
  const smoothProgress = useDerivedValue(() => {
    const smoothedValue =
      currentIntensity.value * (1 - SMOOTHING_FACTOR) +
      intensity * SMOOTHING_FACTOR;
    currentIntensity.value = smoothedValue;
    return smoothedValue;
  }, [intensity]);

  const blobAnimatedStyle = useAnimatedStyle(() => {
    return {
      transform: [
        {
          scale: withSpring(isExpanded ? 1.5 : 1, {
            damping: 15,
            stiffness: 100,
            mass: 1,
          }),
        },
      ],
      marginTop: withTiming(isExpanded ? 150 : 0, {
        duration: 500,
        easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      }),
    };
  }, [isExpanded]);

  const overlayAnimatedStyle = useAnimatedStyle(() => {
    return {
      marginTop: withTiming(isExpanded ? 150 : 0, {
        duration: 500,
        easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      }),
    };
  }, [isExpanded]);

  return (
    <View style={styles.container}>
      <View style={styles.blobContainer}>
        <AnimatedLottieView
          source={blobAnimation as AnimationObject}
          style={[styles.blob, blobAnimatedStyle]}
          autoPlay
          loop
        />
        <Animated.View style={[styles.overlayContainer, overlayAnimatedStyle]}>
          <PlayPauseOverlay
            isPlaying={!isCallPaused}
            onPress={onPlayPauseCallPress}
          />
        </Animated.View>
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    top: '10@vs',
  },
  blobContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  blob: {
    width: '250@ms',
    height: '250@ms',
  },
  overlayContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    zIndex: 1,
  },
});
