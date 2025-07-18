import React, {useEffect} from 'react';
import MaskedView from '@react-native-masked-view/masked-view';
import {StyleProp, View, ViewStyle} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {moderateScale, ScaledSheet} from 'react-native-size-matters';

import {SCREEN_WIDTH} from '@/constants/general';
import {colors} from '@/theme/colors';

const MAX_HEIGHT = 50;
const TINY_BAR_HEIGHT = 0.08; // Tiny bar height for no audio case

const WaveformBar = ({
  amplitude,
  maxHeight,
  customStyle,
}: {
  amplitude: number;
  maxHeight: number;
  customStyle?: StyleProp<ViewStyle>;
}) => {
  const height = useSharedValue(0);

  useEffect(() => {
    const scaled = amplitude * maxHeight;
    height.value = withTiming(scaled, {duration: 100});
  }, [amplitude, height, maxHeight]);

  const animatedStyle = useAnimatedStyle(() => ({
    height: height.value,
  }));

  return <Animated.View style={[styles.bar, customStyle, animatedStyle]} />;
};

interface WaveformProps {
  amplitudes: number[] | null;
  isFocusMode: boolean;
}

export const AudioWaveform: React.FC<WaveformProps> = ({
  amplitudes,
  isFocusMode = true,
}) => {
  const BAR_WIDTH = isFocusMode ? 2.5 : 1;
  const BAR_MARGIN = isFocusMode ? 2 : 1.2;
  const NUM_BARS = Math.floor(SCREEN_WIDTH / (BAR_WIDTH + BAR_MARGIN));

  // Show tiny bars if no audio or all amplitudes are near zero
  const isSilent =
    !amplitudes ||
    amplitudes.length === 0 ||
    amplitudes.every(a => Math.abs(a) < 0.001);

  // Helper to shape the waveform as per requirements
  const processAmplitudes = (amps: number[]): number[] => {
    const totalBars = amps.length;
    if (totalBars === 0) return amps;
    const middle = Math.floor(totalBars / 2);
    const processed = amps.map((amp, i) => {
      if (i < middle) {
        return (amp * (i + 1) * 2) / totalBars;
      } else if (i >= middle) {
        return (amp * (totalBars - i) * 1.5) / totalBars;
      } else {
        return amp;
      }
    });
    return processed;
  };

  const displayAmplitudes = isSilent
    ? new Array(NUM_BARS).fill(TINY_BAR_HEIGHT)
    : processAmplitudes(amplitudes);

  const renderBars = () => {
    return (
      <View style={styles.container}>
        {displayAmplitudes.map((amp, index) => (
          <WaveformBar
            key={index}
            amplitude={amp}
            maxHeight={isFocusMode ? MAX_HEIGHT * 1.4 : MAX_HEIGHT / 1.4}
            customStyle={{
              width: moderateScale(BAR_WIDTH),
              marginHorizontal: moderateScale(BAR_MARGIN / 2),
            }}
          />
        ))}
      </View>
    );
  };

  return (
    <MaskedView maskElement={renderBars()}>
      {renderBars()}
      <LinearGradient
        colors={[
          colors.darkGray7,
          'transparent',
          'transparent',
          'transparent',
          colors.darkGray7,
        ]}
        start={{x: 0, y: 0}}
        end={{x: 1, y: 0}}
        style={styles.fadeOverlay}
      />
    </MaskedView>
  );
};

const styles = ScaledSheet.create({
  container: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    height: moderateScale(MAX_HEIGHT),
    overflow: 'hidden',
    paddingVertical: '10@vs',
    position: 'relative',
  },
  bar: {
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
    backgroundColor: 'transparent',
  },
});
