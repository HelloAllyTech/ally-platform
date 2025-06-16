import React, {useEffect} from 'react';
import {Dimensions, View} from 'react-native';
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
const MAX_HEIGHT = 70; // total height (50 up + 50 down)
const NUM_BARS = Math.floor(SCREEN_WIDTH / (BAR_WIDTH + BAR_MARGIN));

const WaveformBar = ({amplitude}: {amplitude: number}) => {
  const topHeight = useSharedValue(0);
  const bottomHeight = useSharedValue(0);

  useEffect(() => {
    const scaled = amplitude * (MAX_HEIGHT / 2);
    topHeight.value = withTiming(scaled, {duration: 100});
    bottomHeight.value = withTiming(scaled, {duration: 100});
  }, [amplitude, bottomHeight, topHeight]);

  const topStyle = useAnimatedStyle(() => ({
    height: topHeight.value,
  }));

  const bottomStyle = useAnimatedStyle(() => ({
    height: bottomHeight.value,
  }));

  return (
    <View style={styles.barContainer}>
      <Animated.View style={[styles.bar, topStyle]} />
      <Animated.View style={[styles.bar, bottomStyle]} />
    </View>
  );
};

interface WaveformProps {
  amplitudes: number[] | null;
}

export const AudioWaveform: React.FC<WaveformProps> = ({amplitudes}) => {
  // If amplitudes is null or empty, fade out all bars
  const displayAmplitudes =
    amplitudes && amplitudes.length > 0
      ? amplitudes
      : new Array(NUM_BARS).fill(0);

  return (
    <View style={styles.container}>
      {displayAmplitudes.map((amp, index) => (
        <WaveformBar key={index} amplitude={amp} />
      ))}
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
  },
  barContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  bar: {
    width: moderateScale(BAR_WIDTH),
    marginHorizontal: moderateScale(BAR_MARGIN / 2),
    backgroundColor: '#FFFFFF',
    borderRadius: 2,
  },
});
