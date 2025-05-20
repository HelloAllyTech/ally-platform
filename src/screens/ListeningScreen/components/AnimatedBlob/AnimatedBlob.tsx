import React, {useEffect, useRef} from 'react';
import LottieView, {AnimationObject} from 'lottie-react-native';
import {View} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import {ScaledSheet} from 'react-native-size-matters';

import blobAnimation from '@/assets/animations/blobAnimation.json';

import {PlayPauseOverlay} from '../PlayPauseOverlay';

interface AnimatedBlobProps {
  isExpanded: boolean;
  isCallPaused: boolean;
  isAudioActive: boolean;
  onPlayPauseCallPress: () => void;
}

const AnimatedLottieView = Animated.createAnimatedComponent(LottieView);

export const AnimatedBlob: React.FC<AnimatedBlobProps> = ({
  isExpanded,
  isCallPaused,
  isAudioActive,
  onPlayPauseCallPress,
}) => {
  const lottieRef = useRef<LottieView>(null);

  // Handle audio streaming state changes
  useEffect(() => {
    if (isAudioActive) {
      lottieRef.current?.play();
    } else {
      // When stopping, play a tiny segment at the end to ensure we stop at progress 1
      lottieRef.current?.play(0.99, 1);
    }
  }, [isAudioActive]);

  // Cleanup on unmount
  useEffect(() => {
    const animation = lottieRef.current;
    return () => {
      animation?.pause();
    };
  }, []);

  const blobAnimatedStyle = useAnimatedStyle(() => {
    return {
      transform: [
        {
          scale: withTiming(isExpanded ? 1.4 : 1, {
            duration: 500,
            easing: Easing.bezier(0.25, 0.1, 0.25, 1),
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
          ref={lottieRef}
          source={blobAnimation as AnimationObject}
          style={[styles.blob, blobAnimatedStyle]}
          loop
          autoPlay={false}
        />
        <Animated.View
          style={[
            styles.overlayContainer,
            !isExpanded && styles.marginB,
            overlayAnimatedStyle,
          ]}>
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
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  blobContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: '80@ms',
    paddingBottom: '80@ms',
    overflow: 'hidden',
  },
  blob: {
    width: '280@ms',
    height: '280@ms',
  },
  overlayContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    zIndex: 1,
    // TO DO: Remove this once animated blob lottie is finalized
    marginLeft: '20@ms',
  },
  // TO DO: Remove this once animated blob lottie is finalized
  marginB: {
    marginBottom: '10@ms',
  },
});
