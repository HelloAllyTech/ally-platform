import React from 'react';
import {render} from '@testing-library/react-native';

import {
  AudioWaveform,
  shapeAmplitudes,
  SILENT_AMPLITUDES,
} from '../AudioWaveform';

// Mock size-matters moderateScale used in styles
jest.mock('react-native-size-matters', () => {
  const actual = jest.requireActual('react-native-size-matters');
  return {
    __esModule: true,
    ...actual,
    moderateScale: (v: any) => v,
    ScaledSheet: {create: (s: any) => s},
  };
});

// Mock reanimated APIs used in component
jest.mock('react-native-reanimated', () => {
  const View = require('react-native').View;
  const createAnimatedComponent = (c: any) => c;
  return {
    __esModule: true,
    // createAnimatedComponent is reached off the default export by modules pulled
    // in transitively (the utils barrel), so it has to exist in both places.
    default: {View, createAnimatedComponent},
    View,
    useSharedValue: (v: any) => ({value: v}),
    useAnimatedStyle: (_fn: any) => ({}),
    withTiming: (v: any) => v,
    createAnimatedComponent,
  };
});

jest.mock('react-native-linear-gradient', () => {
  const {View} = require('react-native');
  return View;
});

const sharedValue = (value: number[]) => ({value} as any);

describe('AudioWaveform', () => {
  it('renders at rest (silent amplitudes)', () => {
    const {toJSON} = render(
      <AudioWaveform amplitudes={sharedValue(SILENT_AMPLITUDES)} isFocusMode />,
    );
    expect(toJSON()).not.toBeNull();
  });

  it('renders with provided amplitudes', () => {
    const {toJSON} = render(
      <AudioWaveform
        amplitudes={sharedValue([0.2, 0.3, 0.1])}
        isFocusMode={false}
      />,
    );
    expect(toJSON()).not.toBeNull();
  });

  it('renders one bar per amplitude the recorder produces, and nothing more', () => {
    // The bar list is fixed at mount, so its length must not depend on the frame
    // that happens to be in the shared value.
    const barCount = (amplitudes: number[]) => {
      const tree = render(
        <AudioWaveform amplitudes={sharedValue(amplitudes)} isFocusMode />,
      ).toJSON() as any;
      // container children minus the gradient overlay
      return tree.children.length - 1;
    };

    expect(barCount(SILENT_AMPLITUDES)).toBe(SILENT_AMPLITUDES.length);
    expect(barCount([0.5, 0.5])).toBe(SILENT_AMPLITUDES.length);
  });
});

describe('shapeAmplitudes', () => {
  it('falls back to the flat row for a missing or empty frame', () => {
    expect(shapeAmplitudes(null)).toBe(SILENT_AMPLITUDES);
    expect(shapeAmplitudes([])).toBe(SILENT_AMPLITUDES);
  });

  it('treats an all-but-zero frame as silence', () => {
    expect(shapeAmplitudes([0, 0.0001, 0])).toBe(SILENT_AMPLITUDES);
  });

  it('leaves bars sitting on the silence floor untouched', () => {
    expect(shapeAmplitudes([0.02, 0.02, 0.02])).toEqual([0.02, 0.02, 0.02]);
  });

  it('tapers amplitudes towards both edges', () => {
    const shaped = shapeAmplitudes(new Array(9).fill(1));

    // Rises towards the middle from the left, falls away towards the right.
    expect(shaped[0]).toBeLessThan(shaped[3]);
    expect(shaped[8]).toBeLessThan(shaped[5]);
    // Nothing is amplified past the incoming amplitude.
    shaped.forEach(amplitude => expect(amplitude).toBeLessThanOrEqual(1));
  });
});
