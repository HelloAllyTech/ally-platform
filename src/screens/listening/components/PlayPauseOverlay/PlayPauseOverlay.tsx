import React from 'react';
import {TouchableOpacity} from 'react-native';
import Animated, {
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import {ScaledSheet} from 'react-native-size-matters';

import {PauseIcon, PlayIcon} from '@/assets/icons';

interface PlayPauseOverlayProps {
  isPlaying: boolean;
  onPress: () => void;
}

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export const PlayPauseOverlay: React.FC<PlayPauseOverlayProps> = ({
  isPlaying,
  onPress,
}) => {
  const fadeStyle = useAnimatedStyle(() => {
    return {
      opacity: withTiming(1, {
        duration: 200,
        easing: Easing.ease,
      }),
    };
  }, []);

  return (
    <AnimatedTouchable style={[styles.container, fadeStyle]} onPress={onPress}>
      {isPlaying ? (
        <PauseIcon width={17} height={27} />
      ) : (
        <PlayIcon width={16} height={21} />
      )}
    </AnimatedTouchable>
  );
};

const styles = ScaledSheet.create({
  container: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
    width: '60@ms',
    height: '60@ms',
    borderRadius: '30@ms',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
});
