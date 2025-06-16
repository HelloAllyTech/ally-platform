import React, {useEffect} from 'react';
import {Dimensions, View} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {moderateScale, ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme/colors';

const {width: SCREEN_WIDTH} = Dimensions.get('window');

const BAR_WIDTH = 2.5;
const BAR_MARGIN = 2;
const MAX_HEIGHT = 50;
const NUM_BARS = Math.floor(SCREEN_WIDTH / (BAR_WIDTH + BAR_MARGIN));

const WaveformBar = ({
  amplitude,
  maxHeight,
}: {
  amplitude: number;
  maxHeight: number;
}) => {
  const height = useSharedValue(0);

  useEffect(() => {
    const scaled = amplitude * maxHeight;
    height.value = withTiming(scaled, {duration: 100});
  }, [amplitude, height, maxHeight]);

  const animatedStyle = useAnimatedStyle(() => ({
    height: height.value,
  }));

  return <Animated.View style={[styles.bar, animatedStyle]} />;
};

interface WaveformProps {
  amplitudes: number[] | null;
  isFocusMode: boolean;
}

export const AudioWaveform: React.FC<WaveformProps> = ({
  amplitudes,
  isFocusMode = true,
}) => {
  // If amplitudes is null or empty, fade out all bars
  const displayAmplitudes =
    amplitudes && amplitudes.length > 0
      ? amplitudes
      : new Array(NUM_BARS).fill(0);

  return (
    <View style={styles.container}>
      {displayAmplitudes.map((amp, index) => (
        <WaveformBar
          key={index}
          amplitude={amp}
          maxHeight={isFocusMode ? MAX_HEIGHT * 1.4 : MAX_HEIGHT / 1.7}
        />
      ))}
      <LinearGradient
        colors={[
          colors.gunMetal90,
          'transparent',
          'transparent',
          colors.gunMetal90,
        ]}
        start={{x: 0, y: 0}}
        end={{x: 1, y: 0}}
        style={styles.fadeOverlay}
      />
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    height: moderateScale(MAX_HEIGHT),
    overflow: 'hidden',
    backgroundColor: colors.darkGray7,
    paddingVertical: '10@vs',
    position: 'relative',
  },
  bar: {
    width: moderateScale(BAR_WIDTH),
    marginHorizontal: moderateScale(BAR_MARGIN / 2),
    backgroundColor: colors.white,
    borderRadius: 2,
  },
  fadeOverlay: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
  },
});
