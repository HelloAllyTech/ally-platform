import React from 'react';
import {ActivityIndicator, TouchableOpacity} from 'react-native';
import {fireEvent, render} from '@testing-library/react-native';

jest.mock('react-native-size-matters', () => ({
  ScaledSheet: {create: (s: unknown) => s},
}));

jest.mock('@/assets', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    Forward10Icon: (props: any) => <View testID="forward-icon" {...props} />,
    PausePlayerIcon: (props: any) => <View testID="pause-icon" {...props} />,
    PlayWhiteIcon: (props: any) => <View testID="play-icon" {...props} />,
    Replay10Icon: (props: any) => <View testID="replay-icon" {...props} />,
  };
});

jest.mock('@/theme', () => ({
  colors: {
    white: '#fff',
    ds: {
      neutral: {400: '#999'},
      theme: {primary: '#007'},
      grey: {200: '#ddd'},
      blue: {100: '#e0f0ff'},
      typography: {mediumEmphasis: '#666'},
    },
  },
  fontFamily: {IBM_PLEX_SERIF: {REGULAR: {}}},
}));

jest.mock('@/utils', () => ({
  formatTimeToMMSS: (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  },
}));

const mockSeek = jest.fn();
jest.mock('react-native-video', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: React.forwardRef(function MockVideo(props: any, ref: any) {
      React.useImperativeHandle(ref, () => ({seek: mockSeek}));
      return null;
    }),
  };
});

import {SimulationAudioPlayer} from '../SimulationAudioPlayer';

describe('SimulationAudioPlayer', () => {
  const defaultProps = {
    audioUrl: 'https://example.com/audio.mp3',
    onProgress: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders play button initially (not playing)', () => {
    const {getByTestId} = render(<SimulationAudioPlayer {...defaultProps} />);
    expect(getByTestId('play-icon')).toBeTruthy();
  });

  it('toggles play/pause on press', () => {
    const {UNSAFE_getAllByType, getByTestId, queryByTestId} = render(
      <SimulationAudioPlayer {...defaultProps} />,
    );
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    const playBtn = touchables[1];

    expect(getByTestId('play-icon')).toBeTruthy();
    fireEvent.press(playBtn);
    expect(queryByTestId('pause-icon')).toBeTruthy();
  });

  it('renders time displays', () => {
    const {getAllByText} = render(
      <SimulationAudioPlayer {...defaultProps} />,
    );
    const timeTexts = getAllByText('0:00');
    expect(timeTexts.length).toBe(2);
  });

  it('calls onProgress with 0 after rewind press when at start', () => {
    const onProgress = jest.fn();
    const {UNSAFE_getAllByType} = render(
      <SimulationAudioPlayer {...defaultProps} onProgress={onProgress} />,
    );
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    const rewindBtn = touchables[0];

    fireEvent.press(rewindBtn);

    expect(mockSeek).toHaveBeenCalledWith(0);
    expect(onProgress).toHaveBeenCalledWith(0);
  });

  it('calls onProgress after forward press', () => {
    const onProgress = jest.fn();
    const {UNSAFE_getAllByType} = render(
      <SimulationAudioPlayer {...defaultProps} onProgress={onProgress} />,
    );
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    const forwardBtn = touchables[2];

    fireEvent.press(forwardBtn);

    expect(mockSeek).toHaveBeenCalledWith(10);
    expect(onProgress).toHaveBeenCalledWith(10);
  });
});
