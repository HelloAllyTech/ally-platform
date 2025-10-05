import React from 'react';
import {render} from '@testing-library/react-native';

import {AudioWaveform} from '../AudioWaveform';

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
  return {
    __esModule: true,
    default: {View},
    View,
    useSharedValue: (v: any) => ({value: v}),
    useAnimatedStyle: (_fn: any) => ({}),
    withTiming: (v: any) => v,
    createAnimatedComponent: (c: any) => c,
  };
});

jest.mock('@react-native-masked-view/masked-view', () => {
  const React = require('react');
  const {View} = require('react-native');
  return View;
});

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const {View} = require('react-native');
  return View;
});

describe('AudioWaveform', () => {
  it('renders with null amplitudes (silent state)', () => {
    const {toJSON} = render(<AudioWaveform amplitudes={null} isFocusMode={true} />);
    expect(toJSON()).not.toBeNull();
  });

  it('renders with provided amplitudes', () => {
    const {toJSON} = render(<AudioWaveform amplitudes={[0.2, 0.3, 0.1]} isFocusMode={false} />);
    expect(toJSON()).not.toBeNull();
  });
});


