import React, {useEffect, useRef} from 'react';
import LottieView from 'lottie-react-native';
import {View} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import {ScaledSheet} from 'react-native-size-matters';

import {ListeningAnimation} from '../ListeningAnimation/ListeningAnimation';
import {PlayPauseOverlay} from '../PlayPauseOverlay';

interface AnimatedBlobProps {
  isExpanded: boolean;
  isCallPaused: boolean;
  isAudioActive: boolean;
  onPlayPauseCallPress: () => void;
}

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
      lottieRef.current?.pause();
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
          scaleY: withTiming(isExpanded ? 1.4 : 1, {
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
        <Animated.View style={[styles.blob, blobAnimatedStyle]}>
          <ListeningAnimation />
        </Animated.View>
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
    overflow: 'hidden',
  },
  blob: {
    height: '280@ms',
  },
  overlayContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    zIndex: 1,
  },
  marginB: {},
});
