import React, {useMemo} from 'react';
import {StyleProp, View, ViewStyle} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Animated, {
  SharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import {moderateScale, ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme';

import {NUM_BARS} from '../../utils';

const MAX_HEIGHT = 50;
const TINY_BAR_HEIGHT = 0.08; // Tiny bar height for no audio case
const SMOOTHING_DURATION = 100;

/**
 * Silence floor emitted per bar by recorderAudioToAmplitudes. Those bars are
 * already flat, so the edge taper below leaves them alone.
 */
const SILENCE_FLOOR = 0.02;

/**
 * One bar per amplitude the recorder produces, fixed for the lifetime of the
 * screen: the bar list never changes length, so React never reconciles it again
 * after mount.
 */
const BAR_INDICES = Array.from({length: NUM_BARS}, (_, index) => index);

/** The waveform at rest — a flat row of tiny bars. */
export const SILENT_AMPLITUDES: number[] = new Array(NUM_BARS).fill(
  TINY_BAR_HEIGHT,
);

/**
 * Tapers the waveform towards both edges so it reads as one shape rather than a
 * block of bars, and collapses a silent (or missing) frame to the flat row.
 *
 * Runs on the JS side once per frame — a single pass over ~85 numbers — before
 * the result is handed to the UI thread as one shared-value write.
 */
export const shapeAmplitudes = (amplitudes: number[] | null): number[] => {
  const isSilent =
    !amplitudes ||
    amplitudes.length === 0 ||
    amplitudes.every(amplitude => Math.abs(amplitude) < 0.001);

  if (isSilent) return SILENT_AMPLITUDES;

  const totalBars = amplitudes.length;
  const middle = Math.floor(totalBars / 2);

  return amplitudes.map((amplitude, index) => {
    if (amplitude === SILENCE_FLOOR) return amplitude;

    return index < middle
      ? (amplitude * (index + 1) * 2) / totalBars
      : (amplitude * (totalBars - index) * 1.5) / totalBars;
  });
};

interface WaveformBarProps {
  index: number;
  amplitudes: SharedValue<number[]>;
  maxHeight: number;
  barStyle: StyleProp<ViewStyle>;
}

/**
 * Reads its own slot out of the shared frame on the UI thread. Every prop is
 * stable after mount, so a new frame costs no React work at all — only the
 * height each bar animates to changes.
 */
const WaveformBar = React.memo<WaveformBarProps>(
  ({index, amplitudes, maxHeight, barStyle}) => {
    const animatedStyle = useAnimatedStyle(() => ({
      height: withTiming((amplitudes.value[index] ?? 0) * maxHeight, {
        duration: SMOOTHING_DURATION,
      }),
    }));

    return <Animated.View style={[styles.bar, barStyle, animatedStyle]} />;
  },
);

interface WaveformProps {
  /** Latest shaped frame. Written ~8×/s; read per bar on the UI thread. */
  amplitudes: SharedValue<number[]>;
  isFocusMode: boolean;
}

const AudioWaveformComponent: React.FC<WaveformProps> = ({
  amplitudes,
  isFocusMode = true,
}) => {
  const barWidth = isFocusMode ? 2.5 : 1;
  const barMargin = isFocusMode ? 2 : 1.2;
  const maxHeight = isFocusMode ? MAX_HEIGHT * 1.4 : MAX_HEIGHT / 1.4;

  const barStyle = useMemo(
    () => ({
      width: moderateScale(barWidth),
      marginHorizontal: moderateScale(barMargin / 2),
    }),
    [barWidth, barMargin],
  );

  return (
    <View style={styles.container}>
      {BAR_INDICES.map(index => (
        <WaveformBar
          key={index}
          index={index}
          amplitudes={amplitudes}
          maxHeight={maxHeight}
          barStyle={barStyle}
        />
      ))}
      {/*
        Fades the waveform into the screen behind it at both edges. This used to
        be done by masking the gradient with a second copy of every bar, which
        doubled the view count and put a full-width offscreen buffer in the
        redraw path. The gradient's end colour *is* the screen background, so
        painting it straight over the bars looks the same for half the views.
      */}
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
        pointerEvents="none"
      />
    </View>
  );
};

export const AudioWaveform = React.memo(AudioWaveformComponent);

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
