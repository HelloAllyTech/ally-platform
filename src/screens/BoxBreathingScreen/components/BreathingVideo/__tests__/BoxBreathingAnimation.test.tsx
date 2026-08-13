jest.mock('@/hooks/useTranslate', () => {
  const en = require('@/localization/locales/en.json');
  const resolve = (key, vars = {}) => {
    const val = String(key)
      .split('.')
      .reduce((o, p) => (o == null ? undefined : o[p]), en);
    let s = typeof val === 'string' ? val : key;
    Object.keys(vars || {}).forEach(k => {
      s = s.split('{{' + k + '}}').join(String(vars[k]));
    });
    return s;
  };
  return {useTranslate: () => ({t: resolve, tVariable: resolve})};
});

import React from 'react';
import {act, render, waitFor} from '@testing-library/react-native';
import {Animated, Platform} from 'react-native';

import {BoxBreathingAnimation} from '../BoxBreathingAnimation';

// Mock react-native-reanimated
jest.mock('react-native-reanimated', () => {
  const Reanimated = require('react-native-reanimated/mock');
  const withTiming = (toValue: number, config: any, cb?: any) => {
    'worklet';
    if (cb) {
      cb(true);
    }
    return toValue;
  };
  return {
    ...Reanimated,
    withTiming,
  };
});

// Mock SoundPlayer
jest.mock('react-native-sound-player', () => {
  const mockSoundPlayer = {
    playAsset: jest.fn(),
    setMixAudio: jest.fn(),
    seek: jest.fn(),
    play: jest.fn(),
    pause: jest.fn(),
    stop: jest.fn(),
    setVolume: jest.fn(),
  };
  return mockSoundPlayer;
});

// Mock audio file
jest.mock('../../../../assets/sounds/breath.mp3', () => 'test-audio-file');

// Mock FlowerPetal component
jest.mock('../FlowerPetal', () => ({
  FlowerPetal: 'FlowerPetal',
}));

describe('BoxBreathingAnimation', () => {
  const defaultProps = {
    isMuted: false,
    isPlaying: false,
    onPhaseChange: jest.fn(),
    animationDuration: 4000,
  };

  const originalPlatformOS = Platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Ensure tests run with Android platform semantics so SoundPlayer logic is exercised
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      get: () => 'android',
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      get: () => originalPlatformOS,
    });
  });

  it('renders correctly with default props', () => {
    const {getByTestId, getByText} = render(
      <BoxBreathingAnimation {...defaultProps} />,
    );

    expect(getByTestId('box-breathing-container')).toBeTruthy();
    expect(getByTestId('animated-dot')).toBeTruthy();
    expect(getByText('Hold')).toBeTruthy(); // Initial phase label
  });

  it('initializes sound player on mount', () => {
    const SoundPlayer = require('react-native-sound-player');
    render(<BoxBreathingAnimation {...defaultProps} />);

    expect(SoundPlayer.setMixAudio).toHaveBeenCalledWith(true);
    expect(SoundPlayer.playAsset).toHaveBeenCalledWith('test-audio-file');
  });

  it('handles play/pause state changes', () => {
    const SoundPlayer = require('react-native-sound-player');
    const {rerender} = render(<BoxBreathingAnimation {...defaultProps} />);

    // Start playing
    rerender(<BoxBreathingAnimation {...defaultProps} isPlaying={true} />);
    expect(SoundPlayer.seek).toHaveBeenCalledWith(0);
    expect(SoundPlayer.play).toHaveBeenCalled();

    // Pause
    rerender(<BoxBreathingAnimation {...defaultProps} isPlaying={false} />);
    expect(SoundPlayer.pause).toHaveBeenCalled();
  });

  it('handles mute/unmute state changes', () => {
    const SoundPlayer = require('react-native-sound-player');
    const {rerender} = render(<BoxBreathingAnimation {...defaultProps} />);

    // Mute
    rerender(<BoxBreathingAnimation {...defaultProps} isMuted={true} />);
    expect(SoundPlayer.setVolume).toHaveBeenCalledWith(0);

    // Unmute
    rerender(<BoxBreathingAnimation {...defaultProps} isMuted={false} />);
    expect(SoundPlayer.setVolume).toHaveBeenCalledWith(1);
  });

  it('cycles through phases when playing', async () => {
    const onPhaseChange = jest.fn();
    render(
      <BoxBreathingAnimation
        {...defaultProps}
        isPlaying={true}
        onPhaseChange={onPhaseChange}
      />,
    );

    // Initial phase change
    expect(onPhaseChange).toHaveBeenCalledWith(expect.objectContaining({
      name: 'one',
      label: 'boxBreathing.phaseHold',
    }));

    // Advance to next phase
    act(() => {
      jest.advanceTimersByTime(4000);
    });

    expect(onPhaseChange).toHaveBeenCalledWith(expect.objectContaining({
      name: 'two',
      label: 'boxBreathing.phaseInhale',
    }));
  });

  it('resets animation when stopped', () => {
    const {rerender, getByTestId} = render(
      <BoxBreathingAnimation {...defaultProps} isPlaying={true} />,
    );

    // Stop playing
    rerender(<BoxBreathingAnimation {...defaultProps} isPlaying={false} />);

    const dot = getByTestId('animated-dot');
    expect(dot.props.style.transform).toEqual([
      {translateX: -175},
      {translateY: -175},
    ]);
  });

  it('cleans up on unmount', () => {
    const SoundPlayer = require('react-native-sound-player');
    const {unmount} = render(<BoxBreathingAnimation {...defaultProps} />);

    unmount();

    expect(SoundPlayer.stop).toHaveBeenCalled();
    expect(SoundPlayer.setMixAudio).toHaveBeenCalledWith(false);
  });
});
